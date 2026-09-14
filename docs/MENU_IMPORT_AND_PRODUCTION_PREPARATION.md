# Import du menu et préparation de production

`Importer le menu` est réservé au Patron. L’analyse locale extrait le texte du PDF (5 Mio, 30 pages), détecte les doublons et crée une session de prévisualisation. Elle ne crée ni catégorie ni produit. Le Patron corrige les noms/prix et choisit explicitement créer, réutiliser, modifier ou ignorer avant confirmation transactionnelle.

Les PDF scannés ne sont pas envoyés à un tiers. Aucun OCR n’est configuré; ils produisent un message demandant un PDF texte ou un futur OCR local. La description reste dans la prévisualisation, mais le schéma produit actuel ne possède pas de colonne description. Une variante est ajoutée au nom lors de l’import pour ne pas la perdre.

## Sauvegarde vérifiée

```powershell
npm run db:backup:verified
```

La commande crée un dump PostgreSQL custom-format, valide `pg_restore --list`, calcule SHA-256, copie le SQLite legacy et écrit un manifeste `.verified.json` dans `backups/`. Elle utilise les outils PostgreSQL natifs ou le conteneur PostgreSQL 18 local.

## Préparation destructive (jamais automatique)

```powershell
$env:INITIAL_PATRON_NAME = Read-Host "Nom du Patron"
$env:INITIAL_PATRON_EMAIL = Read-Host "E-mail du Patron"
$securePin = Read-Host "PIN/mot de passe" -AsSecureString
$env:INITIAL_PATRON_PASSWORD = [System.Net.NetworkCredential]::new('', $securePin).Password
npm run db:prepare-production -- --database bimik_cafe_import --confirm-database bimik_cafe_import --execute-reset
Remove-Item Env:INITIAL_PATRON_NAME,Env:INITIAL_PATRON_EMAIL,Env:INITIAL_PATRON_PASSWORD
```

Ne lancer cette commande qu’après confirmation explicite du propriétaire dans la session active. Elle refuse les bases système, une cible différente de `DATABASE_URL`, l’absence du drapeau, l’absence d’identifiants ou l’absence d’une sauvegarde vérifiée correspondante. Elle conserve les réglages système/imprimante, efface les valeurs identité/Wi-Fi/ticket à revoir, ne supprime aucun upload, et contrôle les compteurs avant commit. Le schéma actuel ne comporte pas de drapeau imposant un changement de mot de passe au premier login.

Rapport en lecture seule des uploads orphelins:

```powershell
npm run uploads:audit
```
