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
            const token = jwt.sign({ id: tag.id, nev: tag.nev, rang: tag.rang }, JWT_SECRET);
            return res.json({ success: true, token });
        }

        // --- HÍREK (Javítva!) ---
        if (path === '/api/hirek') {
            if (method === 'GET') {
                const { data } = await supabase.from('hirek').select('*').order('datum', { ascending: false });
                return res.json(data || []);
            }
            if (method === 'POST') {
                const { cim, tartalom } = req.body;
                if (!user) return res.status(403).json({ error: 'Bejelentkezés szükséges!' });
                await supabase.from('hirek').insert([{ cim, tartalom, iro: user.nev }]);
                return res.json({ success: true });
            }
        }

        // --- KASSZA (Naplózással együtt!) ---
        if (path === '/api/kassza') {
            if (method === 'GET') {
                const { data: logs } = await supabase.from('kassza_log').select('*').order('datum', { ascending: false }).limit(20);
                const { data: all } = await supabase.from('kassza_log').select('osszeg, tipus');
                const balance = all ? all.reduce((acc, curr) => curr.tipus === 'be' ? acc + curr.osszeg : acc - curr.osszeg, 0) : 0;
                return res.json({ balance, logs: logs || [] });
            }
            if (method === 'POST') {
                const { tipus, osszeg, operator } = req.body;
                await supabase.from('kassza_log').insert([{ tipus, osszeg, operator }]);
                return res.json({ success: true });
            }
        }

        // --- RANGOK ÉS TAGOK (Alap funkciók) ---
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

        res.status(404).json({ error: 'Endpoint not found: ' + path });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}