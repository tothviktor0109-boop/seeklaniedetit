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
        // --- LOGIN ---
        if (path === '/api/login' && method === 'POST') {
            const { nev, jelszo } = req.body;
            const { data: tag } = await supabase.from('tagok').select('*').eq('nev', nev).single();
            if (!tag || tag.jelszo !== jelszo) return res.status(401).json({ error: 'Hibás adatok!' });
            if (tag.elso_belepes) return res.json({ success: true, elso_belepes: true, user: { id: tag.id } });
            
            const { data: jog } = await supabase.from('jogosultsagok').select('*').eq('rang', tag.rang).single();
            const token = jwt.sign({ 
                id: tag.id, nev: tag.nev, rang: tag.rang, 
                prio: jog?.prioritas || 99, 
                jog_kezel: jog?.jog_kezel || false,
                hir_kezel: jog?.hir_kezel || false,
                nev_valtoztat: jog?.nev_valtoztat || false,
                tag_kezel: jog?.tag_kezel || false,
                kassza: jog?.kassza || false,
                hir_iras: jog?.hir_iras || false
            }, JWT_SECRET);
            return res.json({ success: true, token });
        }

        // --- RANGOK KEZELÉSE (POST/PUT/DELETE) ---
        if (path === '/api/jogosultsagok' && method === 'POST') {
            if (!user?.jog_kezel && user?.rang !== 'DEV') return res.status(403).json({ error: 'Nincs jogod!' });
            const { rang, prioritas } = req.body;
            await supabase.from('jogosultsagok').insert([{ rang, prioritas }]);
            return res.json({ success: true });
        }

        if (path.startsWith('/api/jogosultsagok/') && (method === 'PUT' || method === 'DELETE')) {
            const rangNev = decodeURIComponent(path.split('/').pop());
            if (!user?.jog_kezel && user?.rang !== 'DEV') return res.status(403).json({ error: 'Nincs jogod!' });

            // DEV rang védelme
            if (rangNev === 'DEV' && method === 'DELETE') return res.status(400).json({ error: 'A DEV rang törölhetetlen!' });

            if (method === 'PUT') {
                const { mezo, ertek } = req.body;
                await supabase.from('jogosultsagok').update({ [mezo]: ertek }).eq('rang', rangNev);
                return res.json({ success: true });
            }
            if (method === 'DELETE') {
                await supabase.from('jogosultsagok').delete().eq('rang', rangNev);
                return res.json({ success: true });
            }
        }

        // --- KASSZA (Feltöltés és Lekérés) ---
        if (path === '/api/kassza') {
            if (method === 'GET') {
                const { data: all } = await supabase.from('kassza_log').select('osszeg, tipus');
                const { data: logs } = await supabase.from('kassza_log').select('*').order('datum', { ascending: false }).limit(20);
                const balance = all ? all.reduce((acc, curr) => curr.tipus === 'be' ? acc + curr.osszeg : acc - curr.osszeg, 0) : 0;
                return res.json({ balance, logs: logs || [] });
            }
            if (method === 'POST') {
                const { tipus, osszeg, operator, bizonyitek } = req.body;
                await supabase.from('kassza_log').insert([{ tipus, osszeg, operator, bizonyitek }]);
                return res.json({ success: true });
            }
        }

        // --- TAGOK ÉS EGYEBEK (Marad a korábbi logika szerint) ---
        if (path === '/api/tagok' && method === 'GET') { const { data } = await supabase.from('tagok').select('*').order('nev'); return res.json(data); }
        if (path === '/api/tagok' && method === 'POST') { await supabase.from('tagok').insert([{ ...req.body, jelszo: '123456', elso_belepes: true }]); return res.json({ success: true }); }
        if (path.startsWith('/api/tagok/') && method === 'PUT') { await supabase.from('tagok').update(req.body).eq('id', path.split('/').pop()); return res.json({ success: true }); }
        if (path.startsWith('/api/tagok/') && method === 'DELETE') { await supabase.from('tagok').delete().eq('id', path.split('/').pop()); return res.json({ success: true }); }
        if (path === '/api/jogosultsagok' && method === 'GET') { const { data } = await supabase.from('jogosultsagok').select('*').order('prioritas'); return res.json(data); }
        if (path.startsWith('/api/profil/')) { const id = path.split('/').pop(); if (method === 'GET') { const { data } = await supabase.from('tagok').select('*').eq('id', id).single(); return res.json(data); } else { await supabase.from('tagok').update(req.body).eq('id', id); return res.json({ success: true }); } }
        if (path === '/api/hirek') { if (method === 'GET') { const { data } = await supabase.from('hirek').select('*').order('datum', { ascending: false }); return res.json(data); } else { await supabase.from('hirek').insert([{ ...req.body, iro: user.nev }]); return res.json({ success: true }); } }
        if (path.startsWith('/api/hirek/') && method === 'DELETE') { await supabase.from('hirek').delete().eq('id', path.split('/').pop()); return res.json({ success: true }); }

        res.status(404).json({ error: 'Not Found' });
    } catch (err) { res.status(500).json({ error: err.message }); }
}