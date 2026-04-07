const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const JWT_SECRET = process.env.JWT_SECRET || 'titkos-kulcs-123';

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
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
            
            const isDev = tag.rang === 'DEV';
            const token = jwt.sign({ 
                id: tag.id, nev: tag.nev, ic_nev: tag.ic_nev, rang: tag.rang, 
                prio: jog?.prioritas || 99, 
                jog_admin: isDev || jog?.jog_admin || false, 
                hir_kezel: isDev || jog?.hir_kezel || false, 
                nev_valtoztat: isDev || jog?.nev_valtoztat || false, 
                tag_kezel: isDev || jog?.tag_kezel || false, 
                kassza: isDev || jog?.kassza || false, 
                hir_iras: isDev || jog?.hir_iras || false 
            }, JWT_SECRET);
            return res.json({ success: true, token });
        }

        // --- TAGOK MÓDOSÍTÁSA (DEV VÉDELEM) ---
        if (path.startsWith('/api/tagok/') && method === 'PUT') {
            const id = path.split('/').pop();
            const { rang, nev } = req.body;

            // Csak DEV adhat DEV rangot
            if (rang === 'DEV' && user.rang !== 'DEV') {
                return res.status(403).json({ error: 'DEV rangot csak DEV oszthat ki!' });
            }

            // Felhasználónév módosítás korlátozás
            if (nev && user.prio > 2 && user.rang !== 'DEV') {
                return res.status(403).json({ error: 'Nincs jogod a felhasználónév módosításához!' });
            }

            await supabase.from('tagok').update(req.body).eq('id', id);
            return res.json({ success: true });
        }

        // --- TAG FELVÉTEL (DEV VÉDELEM) ---
        if (path === '/api/tagok' && method === 'POST') {
            if (req.body.rang === 'DEV' && user.rang !== 'DEV') {
                return res.status(403).json({ error: 'DEV rangot csak DEV oszthat ki!' });
            }
            await supabase.from('tagok').insert([{ ...req.body, jelszo: '123456', elso_belepes: true }]);
            return res.json({ success: true });
        }

        // --- KASSZA ---
        if (path === '/api/kassza') {
            if (method === 'GET') {
                const { data: all } = await supabase.from('kassza_log').select('osszeg, tipus');
                const { data: logs } = await supabase.from('kassza_log').select('*').order('datum', { ascending: false }).limit(20);
                const balance = all ? all.reduce((acc, curr) => curr.tipus === 'be' ? acc + curr.osszeg : acc - curr.osszeg, 0) : 0;
                return res.json({ balance, logs: logs || [] });
            }
            if (method === 'POST') {
                const { tipus, osszeg, operator, bizonyitek } = req.body;
                const clean_osszeg = parseInt(osszeg.toString().replace(/\s/g, ""));
                const { error } = await supabase.from('kassza_log').insert([{ tipus, osszeg: clean_osszeg, operator, bizonyitek }]);
                if (error) return res.status(500).json({ error: error.message });
                return res.json({ success: true });
            }
        }

        // --- EGYÉB ALAPFUNKCIÓK ---
        if (path === '/api/tagok' && method === 'GET') {
            const { data: tagok } = await supabase.from('tagok').select('*');
            const { data: rangok } = await supabase.from('jogosultsagok').select('rang, prioritas');
            const rendezett = tagok.map(t => ({ ...t, prioritas: rangok.find(r => r.rang === t.rang)?.prioritas || 999 })).sort((a, b) => a.prioritas - b.prioritas);
            return res.json(rendezett);
        }
        if (path.startsWith('/api/tagok/') && method === 'DELETE') {
            const id = path.split('/').pop();
            const { data: target } = await supabase.from('tagok').select('rang').eq('id', id).single();
            if (target.rang === 'DEV' && user.rang !== 'DEV') return res.status(403).json({ error: 'DEV-et nem törölhetsz!' });
            await supabase.from('tagok').delete().eq('id', id);
            return res.json({ success: true });
        }
        if (path === '/api/jogosultsagok' && method === 'GET') { const { data } = await supabase.from('jogosultsagok').select('*').order('prioritas'); return res.json(data); }
        if (path === '/api/jogosultsagok' && method === 'POST') { await supabase.from('jogosultsagok').insert([req.body]); return res.json({ success: true }); }
        if (path.startsWith('/api/jogosultsagok/')) {
            const r = decodeURIComponent(path.split('/').pop());
            if (method === 'PUT') { await supabase.from('jogosultsagok').update(req.body).eq('rang', r); return res.json({ success: true }); }
            if (method === 'DELETE') { if (r === 'DEV') return res.status(400).json({ error: 'DEV fix!' }); await supabase.from('jogosultsagok').delete().eq('rang', r); return res.json({ success: true }); }
        }
        if (path.startsWith('/api/profil/')) {
            const id = path.split('/').pop();
            if (method === 'GET') { const { data } = await supabase.from('tagok').select('*').eq('id', id).single(); return res.json(data); }
            else { await supabase.from('tagok').update(req.body).eq('id', id); return res.json({ success: true }); }
        }
        if (path === '/api/hirek') {
            if (method === 'GET') { const { data } = await supabase.from('hirek').select('*').order('datum', { ascending: false }); return res.json(data); }
            else { await supabase.from('hirek').insert([{ ...req.body, iro: user.nev }]); return res.json({ success: true }); }
        }
        if (path.startsWith('/api/hirek/') && method === 'DELETE') { await supabase.from('hirek').delete().eq('id', path.split('/').pop()); return res.json({ success: true }); }
        if (path === '/api/jelszocsere' && method === 'POST') { await supabase.from('tagok').update({ jelszo: req.body.ujJelszo, elso_belepes: false }).eq('id', req.body.userId); return res.json({ success: true }); }

        res.status(404).send('Not Found');
    } catch (err) { res.status(500).json({ error: err.message }); }
}