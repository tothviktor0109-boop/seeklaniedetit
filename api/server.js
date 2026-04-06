// api/server.js
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const JWT_SECRET = process.env.JWT_SECRET || 'titkos-kulcs-123';

export default async function handler(req, res) {
    const { method, url } = req;
    const path = url.split('?')[0];

    // CORS és Auth helper
    const authHeader = req.headers.authorization;
    let user = null;
    if (authHeader) {
        try { user = jwt.verify(authHeader.split(' ')[1], JWT_SECRET); } catch (e) {}
    }

    try {
        // --- AUTH ---
        if (path === '/api/login' && method === 'POST') {
            const { nev, jelszo } = req.body;
            const { data: tag, error } = await supabase.from('tagok').select('*').eq('nev', nev).single();
            
            if (!tag || tag.jelszo !== jelszo) return res.status(401).json({ error: 'Hibás adatok!' });
            
            if (tag.elso_belepes) return res.json({ success: true, elso_belepes: true, user: { id: tag.id } });
            
            const token = jwt.sign({ id: tag.id, nev: tag.nev, rang: tag.rang }, JWT_SECRET);
            return res.json({ success: true, token });
        }

        // --- HÍREK ---
        if (path === '/api/hirek' && method === 'GET') {
            const { data } = await supabase.from('hirek').select('*').order('datum', { ascending: false });
            return res.json(data);
        }

        // --- KASSZA ---
        if (path === '/api/kassza' && method === 'GET') {
            const { data } = await supabase.from('kassza_log').select('osszeg, tipus');
            const balance = data.reduce((acc, curr) => curr.tipus === 'be' ? acc + curr.osszeg : acc - curr.osszeg, 0);
            return res.json({ balance });
        }

        // --- JOGOSULTSÁGOK ---
        if (path === '/api/jogosultsagok' && method === 'GET') {
            const { data } = await supabase.from('jogosultsagok').select('*').order('prioritas', { ascending: true });
            return res.json(data);
        }

        // --- TAGOK ---
        if (path === '/api/tagok' && method === 'GET') {
            const { data } = await supabase.from('tagok').select('id, nev, discord, rang');
            return res.json(data);
        }

        // --- PROFIL ---
        if (path.startsWith('/api/profil/') && method === 'GET') {
            const id = path.split('/').pop();
            const { data } = await supabase.from('tagok').select('nev, rang, bemutatkozas').eq('id', id).single();
            return res.json(data);
        }

        // Ha nincs találat
        res.status(404).json({ error: 'Not Found' });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}