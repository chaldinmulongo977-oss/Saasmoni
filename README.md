# MoniSaaS — module de paiement SasPay (sans Edge Functions)

1. Exécuter `supabase/migrations/001_payments.sql` (suppose `profiles.role` = client|admin|superadmin et des lignes dans `plans`).
2. Copier `.env.example` en `.env`, remplir Supabase + `SETTINGS_ENCRYPTION_KEY` (`openssl rand -base64 32`) + `APP_URL`.
3. `npm i && npm run dev` (à héberger sur un serveur Node, pas en serverless court).
4. Super admin : ouvrir `AdminPaymentSettings`, coller la clé `sk_test_…`, « Tester la clé ».
5. Dans app.saspay.me : créer le webhook avec l'URL affichée, événements `transaction.*`, copier le `signing_secret` (affiché une seule fois) et le coller dans l'espace super admin.
6. Payer un petit montant en test, puis passer en `sk_live_…`.

Non testé ici (pas d'accès réseau/SasPay) : tout le flux. À valider : réseaux et devises disponibles pour la RDC via « Tester la clé » (`GET /pricing/my-rates/`).

## Plateforme complète (migration 002 + frontend PWA)
1. Exécuter aussi `supabase/migrations/002_platform.sql` ; activer `pg_cron` (Database > Extensions) si la migration le demande.
2. Premier super admin : `update profiles set role='superadmin' where id=(select id from auth.users where email='VOTRE_EMAIL');`
3. Google : Supabase > Authentication > Providers > Google (Client ID/Secret saisis là, jamais dans le frontend). Ajouter l'URL du site dans les « Redirect URLs ».
4. Frontend : copier `frontend/env.example.js` en `frontend/env.js` (URL Supabase, clé anon, URL du backend). Héberger `frontend/` en HTTPS (Vercel, Netlify…). Mettre cette URL dans `FRONTEND_URL` du backend.
5. Le backend (`npm run dev`) lance aussi le moteur de surveillance (toutes les 30 s). Il doit tourner en continu sur un serveur Node.
Non testé : tout (pas de réseau ici). Limites connues : Tailwind via CDN (à compiler pour la production), maintenance appliquée côté interface et au paiement mais pas sur toutes les lectures de données, alertes en application seulement (e-mail/WhatsApp à brancher), pas de test de connexion/parcours Playwright ni de graphiques de courbes.
