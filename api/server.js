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
        // --- LOGIN & AUTH ---
        if (path === '/api/login' && method === 'POST') {
            const { nev, jelszo } = req.body;
            const { data: tag } = await supabase.from('tagok').select('*').eq('nev', nev).single();
            if (!tag || tag.jelszo !== jelszo) return res.status(401).json({ error: 'Hibás adatok!' });
            if (tag.elso_belepes) return res.json({ success: true, elso_belepes: true, user: { id: tag.id } });
            const token = jwt.sign({ id: tag.id, nev: tag.nev, rang: tag.rang }, JWT_SECRET);
            return res.json({ success: true, token });
        }

        // --- RANGOK (JOGOSULTSÁGOK) KEZELÉSE ---
        if (path === '/api/jogosultsagok') {
            if (method === 'GET') {
                const { data } = await supabase.from('jogosultsagok').select('*').order('prioritas', { ascending: true });
                return res.json(data);
            }
            if (method === 'POST') { // Új rang létrehozása
                const { rang, prioritas } = req.body;
                await supabase.from('jogosultsagok').insert([{ rang, prioritas }]);
                return res.json({ success: true });
            }
        }

        if (path.startsWith('/api/jogosultsagok/') && method === 'PUT') {
            const rangNev = decodeURIComponent(path.split('/').pop());
            const { mezo, ertek } = req.body;
            const updateData = {}; updateData[mezo] = ertek;
            await supabase.from('jogosultsagok').update(updateData).eq('rang', rangNev);
            return res.json({ success: true });
        }

        // --- TAGOK KEZELÉSE ---
        if (path === '/api/tagok') {
            if (method === 'GET') {
                const { data } = await supabase.from('tagok').select('id, nev, discord, rang');
                return res.json(data);
            }
            if (method === 'POST') { // Új tag felvétele
                const { nev, discord, rang } = req.body;
                await supabase.from('tagok').insert([{ nev, discord, rang, jelszo: '123456', elso_belepes: true }]);
                return res.json({ success: true });
            }
        }

        if (path.startsWith('/api/tagok/') && method === 'DELETE') {
            const id = path.split('/').pop();
            await supabase.from('tagok').delete().eq('id', id);
            return res.json({ success: true });
        }

        // --- KASSZA MŰVELETEK ---
        if (path === '/api/kassza') {
            if (method === 'GET') {
                const { data } = await supabase.from('kassza_log').select('osszeg, tipus');
                const balance = data ? data.reduce((acc, curr) => curr.tipus === 'be' ? acc + curr.osszeg : acc - curr.osszeg, 0) : 0;
                return res.json({ balance });
            }
            if (method === 'POST') {
                const { tipus, osszeg, operator } = req.body;
                await supabase.from('kassza_log').insert([{ tipus, osszeg, operator }]);
                return res.json({ success: true });
            }
        }

        // --- PROFIL ÉS HÍREK (Alap funkciók) ---
        if (path.startsWith('/api/profil/')) {
            const id = path.split('/').pop();
            if (method === 'GET') {
                const { data } = await supabase.from('tagok').select('nev, rang, bemutatkozas').eq('id', id).single();
                return res.json(data);
            }
        }

        res.status(404).json({ error: 'Endpoint not found' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
    // ... (a kód eleje változatlan)

        // --- KASSZA MŰVELETEK ---
        if (path === '/api/kassza') {
            if (method === 'GET') {
                // Egyenleg és a legutóbbi 10 tranzakció lekérése
                const { data: logs } = await supabase.from('kassza_log').select('*').order('datum', { ascending: false }).limit(10);
                const { data: allData } = await supabase.from('kassza_log').select('osszeg, tipus');
                
                const balance = allData ? allData.reduce((acc, curr) => curr.tipus === 'be' ? acc + curr.osszeg : acc - curr.osszeg, 0) : 0;
                return res.json({ balance, logs: logs || [] });
            }
            if (method === 'POST') {
                const { tipus, osszeg, operator } = req.body;
                if (!tipus || !osszeg || !operator) return res.status(400).json({ error: 'Hiányzó adatok!' });
                
                const { error } = await supabase.from('kassza_log').insert([{ tipus, osszeg, operator }]);
                if (error) return res.status(500).json({ error: error.message });
                
                return res.json({ success: true });
            }
        }
// ... (a kód többi része változatlan)
}