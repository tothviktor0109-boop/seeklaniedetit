const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const JWT_SECRET = process.env.JWT_SECRET || 'titkos-kulcs-123';

export default async function handler(req, res) {
    const { method, url } = req;
    const path = url.split('?')[0];
    const authHeader = req.headers.authorization;
    let user = null;

    if (authHeader) {
        try { user = jwt.verify(authHeader.split(' ')[1], JWT_SECRET); } catch (e) {}
    }

    try {
        // --- AUTH ---
        if (path === '/api/login' && method === 'POST') {
            const { nev, jelszo } = req.body;
            const { data: tag } = await supabase.from('tagok').select('*').eq('nev', nev).single();
            if (!tag || tag.jelszo !== jelszo) return res.status(401).json({ error: 'Hibás adatok!' });
            if (tag.elso_belepes) return res.json({ success: true, elso_belepes: true, user: { id: tag.id } });
            
            // Lekérjük a rang prioritását is a tokenbe
            const { data: jog } = await supabase.from('jogosultsagok').select('prioritas, jog_kezel').eq('rang', tag.rang).single();
            const token = jwt.sign({ id: tag.id, nev: tag.nev, rang: tag.rang, prio: jog.prioritas, jog_kezel: jog.jog_kezel }, JWT_SECRET);
            return res.json({ success: true, token });
        }

        // --- RANGOK KEZELÉSE (BŐVÍTVE) ---
        if (path === '/api/jogosultsagok') {
            if (method === 'GET') {
                const { data } = await supabase.from('jogosultsagok').select('*').order('prioritas', { ascending: true });
                return res.json(data || []);
            }
            if (method === 'POST') { // Új rang
                if (!user?.jog_kezel) return res.status(403).json({ error: 'Nincs jogod!' });
                const { rang, prioritas } = req.body;
                await supabase.from('jogosultsagok').insert([{ rang, prioritas }]);
                return res.json({ success: true });
            }
        }

        // Egyedi rang módosítása/törlése
        if (path.startsWith('/api/jogosultsagok/') && method !== 'GET') {
            const rangNev = decodeURIComponent(path.split('/').pop());
            if (!user?.jog_kezel) return res.status(403).json({ error: 'Nincs jogod!' });

            // Ellenőrizzük a célpont prioritását
            const { data: celpont } = await supabase.from('jogosultsagok').select('prioritas').eq('rang', rangNev).single();
            if (celpont && celpont.prioritas <= user.prio && user.rang !== 'DEV') {
                return res.status(403).json({ error: 'Nincs jogod magasabb vagy egyenlő rangot módosítani!' });
            }

            if (method === 'PUT') {
                const { mezo, ertek } = req.body;
                const updateData = {}; updateData[mezo] = ertek;
                await supabase.from('jogosultsagok').update(updateData).eq('rang', rangNev);
                return res.json({ success: true });
            }

            if (method === 'DELETE') {
                if (rangNev === 'DEV') return res.status(400).json({ error: 'A DEV rang nem törölhető!' });
                await supabase.from('jogosultsagok').delete().eq('rang', rangNev);
                return res.json({ success: true });
            }
        }

        // --- HÍREK, KASSZA, TAGOK --- (A korábbi kódod részei változatlanul menjenek ide)
        // ... (Kihagyva a rövidség kedvéért, de maradjon benne a server.js-ben!)
        // --- HÍREK ---
        if (path === '/api/hirek') {
            if (method === 'GET') {
                const { data } = await supabase.from('hirek').select('*').order('datum', { ascending: false });
                return res.json(data || []);
            }
            if (method === 'POST') {
                const { cim, tartalom } = req.body;
                await supabase.from('hirek').insert([{ cim, tartalom, iro: user?.nev || 'Ismeretlen' }]);
                return res.json({ success: true });
            }
        }

        // --- KASSZA ---
        if (path === '/api/kassza') {
            if (method === 'GET') {
                const { data: logs } = await supabase.from('kassza_log').select('*').order('datum', { ascending: false }).limit(20);
                const { data: all } = await supabase.from('kassza_log').select('osszeg, tipus');
                const balance = all ? all.reduce((acc, curr) => curr.tipus === 'be' ? acc + curr.osszeg : acc - curr.osszeg, 0) : 0;
                return res.json({ balance, logs: logs || [] });
            }
            if (method === 'POST') {
                const { tipus, osszeg, operator, bizonyitek } = req.body;
                await supabase.from('kassza_log').insert([{ tipus, osszeg, operator, bizonyitek }]);
                return res.json({ success: true });
            }
        }

        // --- RANGOK ÉS TAGOK ---
        if (path === '/api/jogosultsagok' && method === 'GET') {
            const { data } = await supabase.from('jogosultsagok').select('*').order('prioritas', { ascending: true });
            return res.json(data || []);
        }

        if (path === '/api/tagok' && method === 'GET') {
            const { data } = await supabase.from('tagok').select('id, nev, discord, rang');
            return res.json(data || []);
        }

        if (path.startsWith('/api/profil/')) {
            const id = path.split('/').pop();
            const { data } = await supabase.from('tagok').select('nev, rang, bemutatkozas').eq('id', id).single();
            return res.json(data || {});
        }

        res.status(404).json({ error: 'Endpoint not found' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}