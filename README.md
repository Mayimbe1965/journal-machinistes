# Journal Machiniste PRO — version 5.0.0

Application PWA locale destinée au suivi professionnel d’un machiniste-receveur :

- journal des services ;
- reconstitution RF / CPMA sur 40 mois ;
- données quotidiennes RF, RT présumés et TS assimilés ;
- import contrôlé du classeur de reconstitution ;
- import et conservation locale des bulletins PDF ;
- registre des incidents ;
- dossier DSP ;
- exports XLSX, PDF, CSV et sauvegarde JSON.

## Référentiel intégré

La base initiale contient les données validées de février 2023 à mai 2026 :

- 40 périodes mensuelles ;
- 1 216 journées ;
- RF théorique final : 109,307 ;
- RF officiel final : 85,650 ;
- différentiel : 23,657 RF ;
- ajustement reconnu de −12 RF en février 2024 au titre du transfert vers le CET.

Le classeur source est conservé dans le dossier `reference/`.

## Installation / lancement

Une PWA doit être servie par HTTP(S), et non ouverte directement avec `file://`.

### Essai local

Dans le dossier de l’application :

```bash
python3 -m http.server 8080
```

Puis ouvrir `http://localhost:8080`.

### Publication

Le dossier peut être déployé tel quel sur GitHub Pages, GitLab Pages, Netlify ou un serveur web statique. Une fois la page ouverte en HTTPS, utiliser le bouton **Installer** du navigateur.

## Confidentialité

Toutes les données sont conservées dans IndexedDB sur l’appareil. Aucun PDF, service ou incident n’est envoyé automatiquement à un serveur.

## Import PDF

Le lecteur PDF embarqué tente une extraction textuelle locale légère. Selon l’encodage du bulletin, le résultat peut être partiel ou nul. Le PDF reste alors conservé et rapproché par son nom/période ; toute extraction doit être contrôlée avant validation.

## Migration

Au premier lancement, l’application recherche les anciennes données `journal_machiniste_pro_v31` et `journal_machiniste_pro_v32` dans le stockage du même navigateur et les migre vers IndexedDB.
