const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const JWT_SECRET = process.env.JWT_SECRET || 'titkos-kulcs-123';
const SALT_ROUNDS = 10;

async function checkAndProcessZaras() {
    try {
        const { data: bData } = await supabase.from('beallitasok').select('ertek').eq('kulcs', 'kov_zaras').single();
        let nextZarasStr = bData?.ertek;

        if (!nextZarasStr) {
            let nextMon = new Date();
            nextMon.setDate(nextMon.getDate() + ((1 + 7 - nextMon.getDay()) % 7 || 7));
            nextMon.setUTCHours(18, 0, 0, 0); 
            await supabase.from('beallitasok').insert([{ kulcs: 'kov_zaras', ertek: nextMon.toISOString() }]);
            return;
        }

        const nextZaras = new Date(nextZarasStr);
        if (new Date() >= nextZaras) {
            let ujZaras = new Date(nextZaras);
            ujZaras.setDate(ujZaras.getDate() + 7);
            await supabase.from('beallitasok').update({ ertek: ujZaras.toISOString() }).eq('kulcs', 'kov_zaras');

            const { data: tagok } = await supabase.from('tagok').select('id, rang, heti_leadva');
            const { data: rangok } = await supabase.from('jogosultsagok').select('rang, leadando');
            const warnsToInsert = [];
            const lejarat = new Date();
            lejarat.setDate(lejarat.getDate() + 30); 

            tagok.forEach(t => {
                const rData = rangok.find(r => r.rang === t.rang);
                const quota = rData ? rData.leadando : 0;
                if (quota > 0 && t.heti_leadva < quota) {
                    warnsToInsert.push({ tag_id: t.id, szervezo_id: null, szervezo_nev: 'RENDSZER AUTOMA', indok: `Leadandó hiánya (Leadva: ${t.heti_leadva}$ / ${quota}$)`, lejaret: lejarat.toISOString() });
                }
            });

            if (warnsToInsert.length > 0) await supabase.from('figyelmeztetesek').insert(warnsToInsert);
            await supabase.from('tagok').update({ heti_leadva: 0 }).gt('id', 0);
        }
    } catch (e) { console.error("Zárás hiba: ", e); }
}

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const { method, url } = req;
    const path = url.split('?')[0];
    const authHeader = req.headers.authorization;
    let user = null;

    if (authHeader) { try { user = jwt.verify(authHeader.split(' ')[1], JWT_SECRET); } catch (e) {} }

    try {
        await checkAndProcessZaras();

        // --- LOGIN ---
        if (path === '/api/login' && method === 'POST') {
            const { nev, jelszo } = req.body;
            const { data: tag } = await supabase.from('tagok').select('*').eq('nev', nev).single();
            if (!tag) return res.status(401).json({ error: 'Hibás adatok!' });
            
            const jelszoEgyezik = await bcrypt.compare(jelszo, tag.jelszo);
            if (!jelszoEgyezik && jelszo !== tag.jelszo) return res.status(401).json({ error: 'Hibás adatok!' });
            if (tag.elso_belepes) return res.json({ success: true, elso_belepes: true, user: { id: tag.id } });
            
            const { data: jog } = await supabase.from('jogosultsagok').select('*').eq('rang', tag.rang).single();
            const isDev = tag.rang === 'DEV';
            
            const token = jwt.sign({ 
                id: tag.id, nev: tag.nev, ic_nev: tag.ic_nev, rang: tag.rang, prio: jog?.prioritas || 99, 
                jog_admin: isDev || jog?.jog_admin || false, hir_kezel: isDev || jog?.hir_kezel || false, 
                nev_valtoztat: isDev || jog?.nev_valtoztat || false, tag_kezel: isDev || jog?.tag_kezel || false, 
                kassza: isDev || jog?.kassza || false, hir_iras: isDev || jog?.hir_iras || false,
                jog_akcio: isDev || jog?.jog_akcio || false, jog_lezart_akcio: isDev || jog?.jog_lezart_akcio || false,
                jog_warn: isDev || jog?.jog_warn || false, jog_akcio_tervezes: isDev || jog?.jog_akcio_tervezes || false
            }, JWT_SECRET);
            return res.json({ success: true, token });
        }

        // --- BIZTONSÁGI ELLENŐRZŐ ---
        if (path === '/api/auth/check' && method === 'GET') {
            if (!user) return res.status(401).json({ valid: false, deleted: true });
            const { data: t } = await supabase.from('tagok').select('*').eq('id', user.id).single();
            if (!t) return res.json({ valid: false, deleted: true }); 
            if (t.rang !== user.rang) {
                const { data: jog } = await supabase.from('jogosultsagok').select('*').eq('rang', t.rang).single();
                const isDev = t.rang === 'DEV';
                const newToken = jwt.sign({ 
                    id: t.id, nev: t.nev, ic_nev: t.ic_nev, rang: t.rang, prio: jog?.prioritas || 99, 
                    jog_admin: isDev || jog?.jog_admin || false, hir_kezel: isDev || jog?.hir_kezel || false, 
                    nev_valtoztat: isDev || jog?.nev_valtoztat || false, tag_kezel: isDev || jog?.tag_kezel || false, 
                    kassza: isDev || jog?.kassza || false, hir_iras: isDev || jog?.hir_iras || false,
                    jog_akcio: isDev || jog?.jog_akcio || false, jog_lezart_akcio: isDev || jog?.jog_lezart_akcio || false,
                    jog_warn: isDev || jog?.jog_warn || false, jog_akcio_tervezes: isDev || jog?.jog_akcio_tervezes || false
                }, JWT_SECRET);
                return res.json({ valid: true, newToken });
            }
            return res.json({ valid: true });
        }

        // --- LEADANDÓ ---
        if (path === '/api/leadando') {
            if (method === 'GET') {
                const { data: tagok } = await supabase.from('tagok').select('id, nev, ic_nev, rang, heti_leadva');
                const { data: rangok } = await supabase.from('jogosultsagok').select('rang, leadando');
                return res.json({ tagok: tagok.map(t => ({ ...t, kotelezo: (rangok.find(r => r.rang === t.rang)?.leadando || 0) })) });
            }
            if (method === 'POST') {
                const { osszeg, bizonyitek } = req.body;
                if (!osszeg || isNaN(osszeg)) return res.status(400).json({error: 'Érvénytelen összeg!'});
                await supabase.from('kassza_log').insert([{ tipus: 'be', osszeg: parseInt(osszeg), operator: user.ic_nev || user.nev, bizonyitek: bizonyitek || 'Heti Leadandó' }]);
                const { data: t } = await supabase.from('tagok').select('heti_leadva').eq('id', user.id).single();
                await supabase.from('tagok').update({ heti_leadva: (t.heti_leadva || 0) + parseInt(osszeg) }).eq('id', user.id);
                return res.json({ success: true });
            }
        }

        // --- WARN ---
        if (path === '/api/warn') {
            if (method === 'GET') { const { data } = await supabase.from('figyelmeztetesek').select('*').order('datum', { ascending: false }); return res.json(data || []); }
            if (method === 'POST') {
                let lejaret = null; 
                if (req.body.napok > 0) { const d = new Date(); d.setDate(d.getDate() + parseInt(req.body.napok)); lejaret = d.toISOString(); }
                await supabase.from('figyelmeztetesek').insert([{ tag_id: req.body.tag_id, szervezo_id: user.id, szervezo_nev: user.ic_nev || user.nev, indok: req.body.indok, lejaret }]); 
                return res.json({ success: true });
            }
        }
        if (path.startsWith('/api/warn/')) {
            const id = path.split('/').pop();
            if (method === 'PUT') { await supabase.from('figyelmeztetesek').update(req.body).eq('id', id); return res.json({ success: true }); }
            if (method === 'DELETE') { await supabase.from('figyelmeztetesek').delete().eq('id', id); return res.json({ success: true }); }
        }

        // --- AKCIÓK (JELENTKEZÉS ÉS KIJELENTKEZÉS) ---
        if (path === '/api/akcio') {
            if (method === 'GET') { const { data } = await supabase.from('akciok').select('*').order('datum', { ascending: false }); return res.json(data || []); }
            if (method === 'POST') {
                const tervezett = req.body.tervezett_ido ? req.body.tervezett_ido : null;
                await supabase.from('akciok').insert([{ tipus: req.body.tipus, szervezo_id: user.id, szervezo_nev: user.ic_nev || user.nev, tervezett_ido: tervezett }]);
                const { data: t } = await supabase.from('tagok').select('akcio_szervezett').eq('id', user.id).single(); 
                await supabase.from('tagok').update({ akcio_szervezett: (t.akcio_szervezett || 0) + 1 }).eq('id', user.id); 

                const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1491388738927067187/zAcIXgjXZdt3bknRRLp4rMnj0paoGYDpu-WsYHg7YJtDeVSq4XS4wzO3CMoRVgXaqhti'; 
                try {
                    let desc = `**Szervező:** ${user.ic_nev || user.nev}`;
                    if(tervezett) desc += `\n**Tervezett időpont:** ${new Date(tervezett).toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' })}\n\nWeben tudtok jelentkezni!`;
                    
                    const discordMessage = {
                        content: "🚨 **Új esemény** 🚨 <@&1491389401606000661>",
                        embeds: [{ title: `[ ${req.body.tipus} ]`, description: desc, color: 3066993, timestamp: new Date().toISOString() }]
                    };
                    await fetch(DISCORD_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(discordMessage) });
                } catch (err) {}
                return res.json({ success: true });
            }
        }
        if (path.startsWith('/api/akcio/') && !path.includes('archiválás')) {
            const id = path.split('/')[3], action = path.split('/')[4];
            
            // JELENTKEZÉS
            if (method === 'PUT' && action === 'join') {
                const { data: a } = await supabase.from('akciok').select('resztvevok').eq('id', id).single(); 
                let r = a.resztvevok || []; r.push({ id: user.id, nev: user.nev, ic_nev: user.ic_nev, ido: new Date().toISOString() });
                await supabase.from('akciok').update({ resztvevok: r }).eq('id', id); 
                const { data: t } = await supabase.from('tagok').select('akcio_resztvett').eq('id', user.id).single(); 
                await supabase.from('tagok').update({ akcio_resztvett: (t.akcio_resztvett || 0) + 1 }).eq('id', user.id); 
                return res.json({ success: true });
            }
            // KIJELENTKEZÉS
            if (method === 'PUT' && action === 'leave') {
                const { data: a } = await supabase.from('akciok').select('resztvevok').eq('id', id).single(); 
                let r = a.resztvevok || []; 
                const ujResztvevok = r.filter(x => x.id !== user.id);
                await supabase.from('akciok').update({ resztvevok: ujResztvevok }).eq('id', id); 
                const { data: t } = await supabase.from('tagok').select('akcio_resztvett').eq('id', user.id).single(); 
                await supabase.from('tagok').update({ akcio_resztvett: Math.max(0, (t.akcio_resztvett || 0) - 1) }).eq('id', user.id); 
                return res.json({ success: true });
            }
            if (method === 'PUT' && action === 'close') { await supabase.from('akciok').update({ aktiv: false }).eq('id', id); return res.json({ success: true }); }
        }
        if (path === '/api/akcio_archiv' && method === 'POST') { 
            await supabase.from('akciok').update({ archivalva: true, aktiv: false }).eq('archivalva', false); 
            await supabase.from('tagok').update({ akcio_szervezett: 0, akcio_resztvett: 0 }).gt('id', 0); return res.json({ success: true }); 
        }

        // --- KASSZA ---
        if (path === '/api/kassza') {
            if (method === 'GET') { 
                const { data: a } = await supabase.from('kassza_log').select('osszeg, tipus'); const { data: l } = await supabase.from('kassza_log').select('*').order('datum', { ascending: false }).limit(30); 
                const b = a ? a.reduce((acc, curr) => curr.tipus === 'be' ? acc + curr.osszeg : acc - curr.osszeg, 0) : 0; return res.json({ balance: b, logs: l || [] }); 
            }
            if (method === 'POST') { await supabase.from('kassza_log').insert([{ tipus: req.body.tipus, osszeg: parseInt(req.body.osszeg), operator: req.body.operator, bizonyitek: req.body.bizonyitek }]); return res.json({ success: true }); }
        }

        // --- TAGOK ÉS JOGOK ---
        if (path === '/api/tagok' && method === 'GET') { const { data: t } = await supabase.from('tagok').select('*'); const { data: r } = await supabase.from('jogosultsagok').select('*'); return res.json(t.map(x => ({ ...x, prioritas: r.find(y => y.rang === x.rang)?.prioritas || 999 })).sort((a, b) => a.prioritas - b.prioritas)); }
        if (path === '/api/tagok' && method === 'POST') { const hp = await bcrypt.hash('123456', SALT_ROUNDS); const { error } = await supabase.from('tagok').insert([{ ...req.body, jelszo: hp, elso_belepes: true }]); if(error) return res.status(400).json({error:'Név már létezik!'}); return res.json({ success: true }); }
        if (path.startsWith('/api/tagok/')) { const id = path.split('/').pop(); if (method === 'PUT') { await supabase.from('tagok').update(req.body).eq('id', id); return res.json({ success: true }); } if (method === 'DELETE') { await supabase.from('tagok').delete().eq('id', id); return res.json({ success: true }); } }

        if (path === '/api/jogosultsagok' && method === 'GET') { const { data } = await supabase.from('jogosultsagok').select('*').order('prioritas'); return res.json(data); }
        if (path === '/api/jogosultsagok' && method === 'POST') { await supabase.from('jogosultsagok').insert([req.body]); return res.json({ success: true }); }
        if (path.startsWith('/api/jogosultsagok/')) { const r = decodeURIComponent(path.split('/').pop()); if (method === 'PUT') { await supabase.from('jogosultsagok').update(req.body).eq('rang', r); return res.json({ success: true }); } if (method === 'DELETE') { await supabase.from('jogosultsagok').delete().eq('rang', r); return res.json({ success: true }); } }

        // --- PROFIL ---
        if (path.startsWith('/api/profil/')) { 
            const id = parseInt(path.split('/').pop()); 
            if (method === 'GET') { 
                const { data: p } = await supabase.from('tagok').select('*').eq('id', id).single(); 
                const { data: w } = await supabase.from('figyelmeztetesek').select('*').eq('tag_id', id).order('datum', { ascending: false }); 
                p.warnings = w.map(x => ({ ...x, aktiv_allapot: x.aktiv && (!x.lejaret || new Date(x.lejaret) > new Date()), indok: (user.jog_warn || user.id === id || user.rang === 'DEV') ? x.indok : '*** Rejtett ***' })); return res.json(p); 
            } else { await supabase.from('tagok').update(req.body).eq('id', id); return res.json({ success: true }); } 
        }

        // --- HÍREK ÉS JELSZÓ ---
        if (path === '/api/hirek') { if (method === 'GET') { const { data } = await supabase.from('hirek').select('*').order('datum', { ascending: false }); return res.json(data); } else { await supabase.from('hirek').insert([{ ...req.body, iro: user.nev }]); return res.json({ success: true }); } }
        if (path.startsWith('/api/hirek/') && method === 'DELETE') { await supabase.from('hirek').delete().eq('id', path.split('/').pop()); return res.json({ success: true }); }
        if (path === '/api/jelszocsere' && method === 'POST') { const hp = await bcrypt.hash(req.body.ujJelszo, SALT_ROUNDS); await supabase.from('tagok').update({ jelszo: hp, elso_belepes: false }).eq('id', req.body.userId); return res.json({ success: true }); }

        res.status(404).send('Not Found');
    } catch (err) { res.status(500).json({ error: err.message }); }
}