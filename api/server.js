const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const JWT_SECRET = process.env.JWT_SECRET || 'titkos-kulcs-123';

export default async function handler(req, res) {
    const { method, url } = req;
    const path = url.split('?')[0];

    // Auth Helper: Token ellenőrzése
    const authHeader = req.headers.authorization;
    let user = null;
    if (authHeader) {
        try { 
            user = jwt.verify(authHeader.split(' ')[1], JWT_SECRET); 
        } catch (e) {
            console.error("JWT Error:", e.message);
        }
    }

    try {
        // --- LOGIN ---
        if (path === '/api/login' && method === 'POST') {
            const { nev, jelszo } = req.body;
            const { data: tag, error } = await supabase.from('tagok').select('*').eq('nev', nev).single();
            
            if (error || !tag || tag.jelszo !== jelszo) {
                return res.status(401).json({ success: false, error: 'Hibás név vagy jelszó!' });
            }
            
            if (tag.elso_belepes) {
                return res.json({ success: true, elso_belepes: true, user: { id: tag.id } });
            }
            
            const token = jwt.sign({ id: tag.id, nev: tag.nev, rang: tag.rang }, JWT_SECRET);
            return res.json({ success: true, token });
        }

        // --- JELSZÓCSERE (Első belépésnél) ---
        if (path === '/api/jelszocsere' && method === 'POST') {
            const { userId, ujJelszo } = req.body;
            await supabase.from('tagok').update({ jelszo: ujJelszo, elso_belepes: false }).eq('id', userId);
            return res.json({ success: true });
        }

        // --- HÍREK ---
        if (path === '/api/hirek') {
            if (method === 'GET') {
                const { data } = await supabase.from('hirek').select('*').order('datum', { ascending: false });
                return res.json(data);
            }
            if (method === 'POST') {
                const { cim, tartalom } = req.body;
                await supabase.from('hirek').insert([{ cim, tartalom, iro: user.nev }]);
                return res.json({ success: true });
            }
        }

        // --- KASSZA ---
        if (path === '/api/kassza') {
            const { data } = await supabase.from('kassza_log').select('osszeg, tipus');
            const balance = data ? data.reduce((acc, curr) => curr.tipus === 'be' ? acc + curr.osszeg : acc - curr.osszeg, 0) : 0;
            return res.json({ balance });
        }

        // --- JOGOSULTSÁGOK ---
        if (path === '/api/jogosultsagok') {
            if (method === 'GET') {
                const { data } = await supabase.from('jogosultsagok').select('*').order('prioritas', { ascending: true });
                return res.json(data);
            }
        }

        // --- EGYEDI JOG MÓDOSÍTÁSA (PUT /api/jogosultsagok/RangNev) ---
        if (path.startsWith('/api/jogosultsagok/') && method === 'PUT') {
            const rangNev = decodeURIComponent(path.split('/').pop());
            const { mezo, ertek } = req.body;
            const updateData = {};
            updateData[mezo] = ertek;
            await supabase.from('jogosultsagok').update(updateData).eq('rang', rangNev);
            return res.json({ success: true });
        }

        // --- TAGOK LISTÁJA ---
        if (path === '/api/tagok') {
            if (method === 'GET') {
                const { data } = await supabase.from('tagok').select('id, nev, discord, rang');
                return res.json(data);
            }
        }

        // --- PROFIL ---
        if (path.startsWith('/api/profil/')) {
            const id = path.split('/').pop();
            if (method === 'GET') {
                const { data } = await supabase.from('tagok').select('nev, rang, bemutatkozas').eq('id', id).single();
                return res.json(data);
            }
            if (method === 'PUT') {
                const { bemutatkozas } = req.body;
                await supabase.from('tagok').update({ bemutatkozas }).eq('id', id);
                return res.json({ success: true });
            }
        }

        res.status(404).json({ error: 'Endpoint nem található: ' + path });

    } catch (err) {
        console.error("Server Error:", err);
        res.status(500).json({ error: 'Szerver hiba történt!' });
    }
}