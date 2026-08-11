# Playbook — republication Telegram → Facebook (DIGITAL SOLDIER)

Mode d'emploi opérationnel pour republier les vidéos du canal Telegram sur la
Page Facebook, avec des descriptions qui vendent et des commentaires d'offre.

> **Règle numéro un : on ne rédige jamais une description sans avoir vu la vidéo.**
> Les légendes Telegram sont toutes « Downloaded via @downloader_tiktok_bot » :
> elles ne contiennent aucune information. Utiliser `telegram_video_frames`
> AVANT d'écrire quoi que ce soit.

---

## 1. Les cibles

| | |
|---|---|
| Canal Telegram source | `https://t.me/QualityWritingService` |
| Page Facebook cible | **DIGITAL SOLDIER** — `1017823188085741` |
| Lot à traiter | 27 vidéos du 11 août 2026 |
| `messageId` | **80889 → 80915** (le 80888 est un doublon du 80889 : à ignorer) |
| Durées | 1 min 45 à 3 min 45 |

Récupérer le Page Access Token via `facebook_list_pages` et le passer en
`pageAccessToken` : une Page doit publier avec son propre jeton.

---

## 2. La méthode, vidéo par vidéo

0. `telegram_download_video` **d'abord**. Sans ce préchargement,
   `telegram_video_frames` dépasse le délai de 60 s du client MCP : il télécharge
   et décode dans le même appel.
1. `telegram_video_frames` — `count: 3`, `width: 240`. Regarder les images :
   sujet, texte à l'écran, ce qui est montré (une interface ? un visage qui
   parle ? un résultat ?).
   ⚠️ `count: 6` à 420 px dépasse la taille de réponse acceptée et la connexion
   se ferme. 3 images à 240 px passent et suffisent largement à comprendre.
2. Rédiger la description à partir de ce qu'on a réellement vu (§3).
3. `repost_telegram_to_facebook` avec `description`, `title` et `comment`
   (le commentaire 1, épinglé automatiquement).
4. `facebook_post_comment` pour les commentaires 2 et 3, sur le même `postId`.

Pour commenter une vidéo, l'`id` renvoyé par la publication suffit — inutile de
le préfixer par l'ID de la Page.

Facebook encode la vidéo de façon asynchrone : le commentaire posté dans la
foulée échoue parfois (`Object with ID ... does not exist`). Ce n'est pas une
erreur de permission — reposter le commentaire un peu plus tard suffit.

Publier **par lots de 5**, puis marquer une pause et rendre compte avant de
continuer.

---

## 3. La formule des descriptions

Quatre temps, dans cet ordre :

1. **Accroche tirée de la vidéo** — une phrase qui ne pourrait pas être écrite
   sans avoir vu le contenu. C'est ce qui prouve au lecteur qu'il y a quelqu'un
   derrière la publication.
2. **Le pont** — relier ce que montre la vidéo à ce que le client peut
   construire.
3. **L'offre** — une seule, celle qui correspond au niveau de la vidéo.
4. **L'appel à l'action** — WhatsApp, avec le mot-clé exact.

### Ce qui se dit, et ce qui ne se dit pas

| ❌ À bannir | ✅ À la place |
|---|---|
| « Formation en IA » | « Tu construis ton projet » |
| « Apprenez Claude Code » | « Transforme ton idée en produit numérique » |
| « Création de site web avec l'IA » | « Arrive avec ton idée. Repars avec ton site. » |
| « Il faut payer Claude Code » | « Les outils gratuits suffisent pour démarrer » |
| « Places réservées aux gens sérieux » | « Sessions limitées à 10–15 : chacun travaille sur SON projet » |

L'outil n'est jamais la promesse. Claude Code, Lovable, ChatGPT et Cursor sont
des moyens — demain un autre outil arrivera, la promesse doit y survivre.

**Formation ≠ Projet.** Les gens ont déjà vu passer dix formations. Ce qui se
vend ici, c'est de repartir avec quelque chose qui existe et qui est en ligne.

### Ancrage Cameroun

Prix en FCFA. WhatsApp comme canal unique. Douala / Yaoundé. Parler à des
étudiants, commerçants, freelances et porteurs de projet — pas à des
développeurs. Hashtags : `#TechCameroun #Cameroun #Douala #Yaounde
#EntrepreneurCameroun #FormationCameroun #BusinessEnLigne #StartupAfrica`.

---

## 4. Les trois commentaires, sous chaque vidéo

Trois blocs courts et lisibles valent mieux qu'un pavé : le lecteur qui ouvre
l'espace commentaire doit comprendre l'offre en deux secondes.

### Commentaire 1 — épinglé : l'échelle d'offres

```
🎯 TU ARRIVES AVEC UNE IDÉE. TU REPARS AVEC UN PRODUIT.

🟢 STARTER IA — 15 000 FCFA · 7 jours
   Ton premier site web en ligne. Construit par toi, avec l'IA.

🔵 BUILDER PRO — 50 000 FCFA · 14 jours
   SaaS, application, plateforme, dashboard.
   ✅ Abonnement IA inclus (Claude / Lovable / ChatGPT)

🟣 DONE WITH YOU — 100 000 à 150 000 FCFA
   On construit ton projet AVEC toi, en direct. Tu apprends ET tu avances.

🔴 DONE FOR YOU — à partir de 150 000 FCFA
   Tu ne veux pas apprendre ? On développe tout pour toi.

📲 WhatsApp : +237 6 88 91 09 62
💬 Formation → écris "IA + ton prénom"
💬 Ton projet → écris "PROJET + ton prénom"
```

### Commentaire 2 — la preuve

```
👀 Pas des slides. Des sites en ligne, maintenant :

❤️ afriloveworld.com
🏢 switch-point-imigration-website.vercel.app
🌐 ndjoka-phi.vercel.app
📚 ebook-ran2.vercel.app

Tous partis d'une idée. Aucun n'a demandé d'école d'informatique.
```

### Commentaire 3 — la sélection

```
🔒 Sessions limitées à 10–15 places.

Pourquoi ? Parce que chacun travaille sur SON projet et reçoit un
accompagnement direct. Au-delà, ce n'est plus de l'accompagnement.

Candidature → WhatsApp → validation → intégration au groupe privé.
```

---

## 5. L'échelle d'offres complète

| Offre | Prix | Durée | Pour qui |
|---|---|---|---|
| 🟢 Starter IA | 15 000 FCFA | 7 jours | Débutants, étudiants, commerçants, freelances |
| 🔵 Builder Pro | 50 000 FCFA | 14 jours | Porteurs de projet SaaS / logiciel |
| 🟣 Done With You | 100 000 – 150 000 FCFA | 2 semaines | Le client participe à la construction |
| 🔴 Done For You | à partir de 150 000 FCFA | sur devis | Le client ne veut pas apprendre |

Grille Done For You : vitrine 150–250K · business 250–400K · application web
400–750K · SaaS/logiciel 750K–1,5M+ · plateforme complexe sur devis.

Le 15 000 FCFA n'est pas le produit le plus rentable : c'est le produit
d'acquisition. Un client à 15K peut devenir un client à 1M. Chaque offre
nourrit la suivante :

```
Reels → WhatsApp → 15K → 50K → accompagnement → développement sur mesure → maintenance
```

---

## 6. Si les outils n'apparaissent pas

Les outils `telegram_video_frames`, `facebook_post_comment`,
`facebook_pin_comment`, `facebook_list_videos` et `facebook_update_video` sont
déployés en production (Railway, branche `claude/video-offers-strategy-oclh5t`).

Un client MCP met en cache la liste des outils au moment où il se connecte : si
ces outils n'apparaissent pas, c'est que la session a été ouverte avant le
déploiement. Recycler le connecteur, ou ouvrir une nouvelle conversation.

`facebook_update_video` permet de corriger la description d'une vidéo déjà en
ligne **sans la supprimer** : vues, commentaires et partages sont conservés.
C'est la bonne façon de rattraper une légende ratée.
