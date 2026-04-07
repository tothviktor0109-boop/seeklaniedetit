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
        // --- AUTH & LOGIN ---
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
                nev_valtoztat: jog?.nev_valtoztat || false
            }, JWT_SECRET);
            return res.json({ success: true, token });
        }

        // --- KÖZLEMÉNYEK TÖRLÉSE ---
        if (path.startsWith('/api/hirek/') && method === 'DELETE') {
            if (!user?.hir_kezel) return res.status(403).json({ error: 'Nincs jogod a törléshez!' });
            const id = path.split('/').pop();
            await supabase.from('hirek').delete().eq('id', id);
            return res.json({ success: true });
        }

        // --- TAGOK SZERKESZTÉSE (Név és Rang) ---
        if (path.startsWith('/api/tagok/') && method === 'PUT') {
            if (!user?.jog_kezel) return res.status(403).json({ error: 'Nincs jogod a szerkesztéshez!' });
            const id = path.split('/').pop();
            const { nev, rang } = req.body;
            
            // Prioritás ellenőrzés (erősebbet nem szerkeszthet)
            const { data: target } = await supabase.from('tagok').select('rang').eq('id', id).single();
            const { data: tJog } = await supabase.from('jogosultsagok').select('prioritas').eq('rang', target.rang).single();
            if (user.prio >= tJog.prioritas && user.rang !== 'DEV') return res.status(403).json({ error: 'Erősebb rangút nem szerkeszthetsz!' });

            const updateData = {};
            if (nev && user.nev_valtoztat) updateData.nev = nev;
            if (rang) updateData.rang = rang;

            await supabase.from('tagok').update(updateData).eq('id', id);
            return res.json({ success: true });
        }

        // --- JELSZÓCSERE ---
        if (path === '/api/jelszocsere' && method === 'POST') {
            const { userId, ujJelszo } = req.body;
            await supabase.from('tagok').update({ jelszo: ujJelszo, elso_belepes: false }).eq('id', userId);
            return res.json({ success: true });
        }

        // --- TAGOK LISTÁJA ÉS FELVÉTELE ---
        if (path === '/api/tagok') {
            if (method === 'GET') {
                const { data } = await supabase.from('tagok').select('id, nev, discord, rang').order('nev', { ascending: true });
                return res.json(data || []);
            }
            if (method === 'POST') {
                if (!user?.tag_kezel) return res.status(403).json({ error: 'Nincs jogod tagfelvételhez!' });
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

        // --- PROFIL ---
        if (path.startsWith('/api/profil/')) {
            const id = path.split('/').pop();
            if (method === 'GET') {
                const { data } = await supabase.from('tagok').select('nev, rang, discord, bemutatkozas').eq('id', id).single();
                return res.json(data || {});
            }
            if (method === 'PUT') {
                const { bemutatkozas } = req.body;
                await supabase.from('tagok').update({ bemutatkozas }).eq('id', id);
                return res.json({ success: true });
            }
        }

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

        // --- RANGOK (JOGOK) ---
        if (path === '/api/jogosultsagok') {
            if (method === 'GET') {
                const { data } = await supabase.from('jogosultsagok').select('*').order('prioritas', { ascending: true });
                return res.json(data || []);
            }
            if (method === 'POST') {
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

        if (path.startsWith('/api/jogosultsagok/') && method === 'DELETE') {
            const rangNev = decodeURIComponent(path.split('/').pop());
            await supabase.from('jogosultsagok').delete().eq('rang', rangNev);
            return res.json({ success: true });
        }

        res.status(404).json({ error: 'Endpoint not found' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}