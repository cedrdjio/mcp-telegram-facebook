# Playbook — republication NovaGo (immigration Canada)

Deuxième Page, deuxième positionnement. La méthode technique est celle du
[playbook DIGITAL SOLDIER](./PLAYBOOK-REPUBLICATION.md) — seuls l'angle de
vente et les commentaires changent.

---

## 1. Les cibles

| | |
|---|---|
| Source Telegram | `@downloader_tiktok_bot` (chat privé, pas un canal) |
| Page Facebook | **NovaGo Immigration•Études•Travail** — `1279391478586523` |
| Site | novago-immigration.ca |
| Lot du 2 août | `messageId` **80769 → 80813**, 23 vidéos, 16 à 48 s |

⚠️ `telegram_list_videos` n'examine que 100 messages et ne pagine pas : le lot
du 2 août pourrait compter des vidéos antérieures au 80769, hors de portée de
l'outil en un seul appel.

---

## 2. L'échelle d'offres

Le levier principal est le **comparatif de prix avec un cabinet ou un avocat**.
Il ouvre chaque commentaire épinglé, avant même l'offre.

| Offre | Prix | Équivalent ailleurs |
|---|---|---|
| 📘 Ebook Entrée Express | 15 000 FCFA | — |
| 📞 Rendez-vous expert, 45 min | 25 000 FCFA | 100 000 à 200 000 FCFA de l'heure |
| 🎓 Formation en visioconférence | 50 000 FCFA | — |
| 🚀 Programme NovaGo complet | 297 $ | 1 500 000 à 3 000 000 FCFA de prise en charge |

Mots-clés WhatsApp : `EBOOK`, `RDV`, `VISIO` + prénom.

---

## 3. Les arguments qui portent

Tirés des données publiques, ils reviennent dans les descriptions :

- Tirage francophone : dossiers acceptés dès **393 points**, contre **510+** en
  tirage général.
- Parler français : jusqu'à **50 points bonus** au score CRS.
- Cible officielle : **30 267 résidents permanents francophones en 2026** hors
  Québec.
- Le Canada est le 2ᵉ plus grand pays du monde pour ~40 millions d'habitants.

Angle central, repris du site : **« Tu n'as pas besoin d'une information de
plus. Tu as besoin d'une méthode. »**

Et son corollaire, qui désamorce l'objection « l'information est gratuite » :
*accessible ne veut pas dire compréhensible — le problème n'est pas l'accès,
c'est l'ordre dans lequel on te la donne.*

---

## 4. Le cadre légal, non négociable

NovaGo vend de l'information et de la préparation, **jamais de la
représentation**. Le commentaire 3 le dit explicitement sous chaque vidéo.

| ❌ Interdit | ✅ À la place |
|---|---|
| « Visa garanti », « 100 % d'acceptation » | « Éviter les erreurs qui font refuser » |
| « On remplit ton dossier » | « On te montre quoi mettre dans chaque case » |
| Logo IRCC ou gouvernement du Canada | Aucun signe officiel |
| Promettre un emploi | Expliquer les permis de travail |

Cette prudence protège de deux choses à la fois : la fermeture de la Page par
Meta, et l'article 91 de l'IRPA qui réserve le conseil payant en immigration
aux consultants agréés, avocats et notaires du Québec.

---

## 5. Les trois commentaires

Commentaire 1 épinglé automatiquement via `repost_telegram_to_facebook`, les
deux autres postés ensuite avec `facebook_post_comment`.

### 1 — le comparatif et l'échelle

```
🇨🇦 CE QUE TU PAIES AILLEURS ▸ CE QUE TU PAIES ICI

❌ Une consultation en cabinet : 100 000 à 200 000 FCFA de l'heure
❌ Prise en charge complète du dossier : 1 500 000 à 3 000 000 FCFA
❌ Et à la fin ? Aucune garantie. La décision appartient au Canada.

✅ NOVAGO :

📘 EBOOK ENTRÉE EXPRESS — 15 000 FCFA
📞 RENDEZ-VOUS EXPERT — 25 000 FCFA · 45 min
🎓 FORMATION EN VISIO — 50 000 FCFA
🚀 PROGRAMME NOVAGO COMPLET — 297 $ · novago-immigration.ca

📲 WhatsApp : +237 6 88 91 09 62
💬 "EBOOK + ton prénom" · "RDV + ton prénom" · "VISIO + ton prénom"
```

### 2 — l'avantage francophone chiffré

### 3 — le cadre légal et la sélection (12 places en visio)

Textes complets : voir les publications en ligne, identiques sur les 23 vidéos.

---

## 6. Répartition des offres sur le lot du 2 août

Le commentaire épinglé porte toujours l'échelle complète ; la **description**,
elle, ne pousse qu'une seule offre, celle que le contenu de la vidéo justifie.

| Offre poussée | Vidéos |
|---|---|
| 📘 Ebook | 80775, 80779, 80783, 80791, 80799, 80811 |
| 📞 Rendez-vous | 80769, 80771, 80781, 80785, 80793, 80797, 80803, 80809 |
| 🎓 Visio | 80773, 80787, 80805 |
| 🚀 Programme | 80789, 80795, 80807 |
| Échelle complète | 80777, 80801, 80813 (clôture de série) |
