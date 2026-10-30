# The Innovators: a language-change role-play game

A social-deduction game for **Sociolinguistics, Chapter 9: Language change** (Holmes & Wilson, *An Introduction to Sociolinguistics*, 6th ed.). It is built for a whole class (4–40 players; best with 15–25) playing at the same time on their phones, with the teacher's screen on the projector.

**The idea.** A small community has four network groups: two close-knit (Harbour, Hillside Farms) and two loose-knit (Market Town, Campus). Every student also has an age group, and some are **link-persons** with ties to a second group.

- 2–3 secret **Innovators** spread a new pronunciation (a "variant") by choosing people to talk to.
- Everyone else is a **Sociolinguist**. They answer Chapter 9 fieldwork questions to earn tokens and fill the class research bar. They spend tokens on evidence (speech recordings, network surveys, apparent-time surveys, network interviews), then discuss and vote out suspects.
- Ordinary students can pick up the variant **without knowing it** (change from below). So "uses the variant" does not prove someone is an Innovator.

**The role-play.**
- **Characters:** every student gets a character card: a job (fisher, café owner, radio DJ, bank clerk…), an attitude that fits their network (proud local, businessperson, trend-loving student…), a personal goal, and notes for their age group and link-person ties. They speak as this character all game.
- **A variant students actually say:** each game has one "variable under study" that students really use when speaking: th-fronting ("I fink so"), the slang word "glim", the tag "innit?", the quotative "this is me: …", or uptalk. Innovators use it every time they speak. When a student picks it up, their phone tells them to start using it too. Sociolinguists listen for it and mark who they hear in a private listening log.
- **Walking on the island map:** in fieldwork, every student moves their own character (an original speech-bubble figure) around the island on their phone, using the joystick, by tapping the map, or with arrow keys on a laptop. Fieldwork tasks are locked at places on the map (Harbour dock, Market square, Campus library…), so students must walk there to answer them. The projector shows everyone moving live. In the meeting it shows dotted trails of where each person walked, which is evidence for the discussion.
- **Face-to-face chats:** when two characters meet on the map, a student taps **💬 Talk**. Both phones buzz: "Chat with Budi! Find them in the room and talk in character." Each student can have at most 2 chats per round. The Innovators' chats are how the variant spreads. Everyone's chats earn tokens, so the Innovators blend in.
- **Town meeting:** each meeting has a community issue (a tourist resort, a bridge to the mainland, closing the village school…). Characters argue about it, then the class discusses who started the new way of speaking.

- **Full-screen phone controls:** during fieldwork the phone works like a game. The map fills the screen, the joystick is bottom-left, and four big action buttons are bottom-right: **💬 Talk** (lights up next to someone), **📝 Task** (lights up at a task spot), **🎙️ Record** and **▶ Listen**. The bottom bar opens Tasks, Evidence, Me (role, character, variant) and 📖 Terms without leaving the map.
- **Field notes (no preparation needed):** each task opens with a short 📖 field note explaining the Chapter 9 concept (e.g. covert prestige, apparent time) before the question. A 📖 Terms glossary is always one tap away.
- **Voice notes (can be switched off):** in **Settings → Voice notes**, choose On or Off. When On, students can record a short voice note in character (max 12 s, **+1 🪙 once per round**). Anyone near them on the map can tap **▶ Listen**, and buying a "Speech recording" as evidence lets you play that person's clip. On the **projector**, the town meeting shows **🎧 Play voice notes to the class**, and the debrief lists every recording round by round, labelled *Innovator* / *picked it up in round X* / *never adopted*, so the class can hear the change spreading. Turn it **Off** for a simple face-to-face class: phones then only show 💬 Talk and 📝 Task. The browser asks for microphone permission the first time.

**Who wins.**
- **Sociolinguists** win if they vote out every Innovator, or if the research bar fills first.
- **Innovators** win if the variant reaches the tipping point (default 70%), or if they survive all the rounds.

**Each round (about 16 min):** Fieldwork: map, chats + tasks (7 min) → spread is calculated → Town meeting (7 min) → Vote (1.5 min) → Reveal. At the end, the projector shows a debrief: the adoption curve compared with the S-curve, adoption by network and by age group, who passed the variant to whom, and six discussion questions tied to the chapter.

---

## Files

| File | What it is |
|---|---|
| `index.html` | Start page (students join, teacher hosts) |
| `host.html` | Teacher / projector screen |
| `play.html` | Student phone screen |
| `printable.html` | **Paper backup**: printable role cards, tracking sheet and dice rules for when the internet fails |
| `js/questions.js` | The 54 fieldwork questions and the evidence types. **Edit this to change or add questions.** |
| `js/roleplay.js` | Characters, the speakable variants, chat topics and town-meeting issues. **Edit this to change the role-play.** |
| `js/game.js` | Rules and settings (spread chances, defaults) |
| `js/config.js` | **Where you paste your Firebase config** (step 2) |
| `database.rules.json` | Security rules to paste into Firebase (step 2) |

**Demo mode:** until you fill in `js/config.js`, the game runs in demo mode. It works only in tabs of one browser on one computer, so you can open `host.html` in one tab and `play.html` in several other tabs to try it out.

---

## Step 1: Put the game on GitHub Pages (about 10 minutes)

1. Create a free account at <https://github.com> (or sign in).
2. Click **+** (top right) → **New repository**. Name it `innovators-game`, choose **Public**, then click **Create repository**.
3. On the new repository page, click **uploading an existing file**. Unzip the game on your computer, then drag **all the files and folders inside** the `innovators-game` folder (`index.html`, `host.html`, `css`, `js`, …) into the upload box. Click **Commit changes**.
4. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, branch **main**, folder **/ (root)**. Click **Save**.
5. Wait 1–2 minutes. Your game is now at:
   `https://YOUR-USERNAME.github.io/innovators-game/`

## Step 2: Set up Firebase for live multiplayer (about 15 minutes, free)

1. Go to <https://console.firebase.google.com> and sign in with a Google account. Click **Create a project**, name it (e.g. `innovators-game`), and you can switch Google Analytics **off**.
2. **Create the database.** In the left menu: **Build → Realtime Database → Create Database**.
   - Location: **Singapore (asia-southeast1)**, the closest to Jakarta.
   - Choose **Start in locked mode** → **Enable**.
3. **Paste the security rules.** Still in Realtime Database, open the **Rules** tab. Delete what's there, paste the entire contents of `database.rules.json`, and click **Publish**.
4. **Turn on anonymous sign-in**, so students don't need accounts. Go to **Build → Authentication → Get started → Sign-in method**, click **Anonymous**, toggle **Enable**, then **Save**.
5. **Allow your GitHub address.** In **Authentication → Settings → Authorized domains**, click **Add domain** and enter `YOUR-USERNAME.github.io`.
6. **Get your config.** Click the ⚙️ gear (top left) → **Project settings** → scroll to *Your apps* → click the **web icon `</>`**. Give it a nickname, leave Hosting unticked, and click **Register app**. You'll see a block like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "innovators-game.firebaseapp.com",
     databaseURL: "https://innovators-game-default-rtdb.asia-southeast1.firebasedatabase.app",
     projectId: "innovators-game",
     ...
   };
   ```
   If `databaseURL` is missing, copy it from the top of the Realtime Database page.
7. **Paste it into the game.** On GitHub, open `js/config.js`, click the ✏️ pencil, and replace the empty values with yours. Keep the quotes and commas. Click **Commit changes**. After 1–2 minutes the demo banner disappears and the game is live.

> The Firebase "apiKey" is not a secret password; it's normal for it to be visible in a web page. Your data is protected by the rules from step 3.

**Free plan limits:** the free Spark plan allows 100 people connected at the same time, which is plenty for one class.

## Step 3: Test before class

1. On your laptop, open `https://YOUR-USERNAME.github.io/innovators-game/host.html` and click **Create new game**.
2. On your phone, scan the QR code (or open the link and type the room code), then join with a name.
3. Ask a colleague, or use a second phone, to join too. With at least 4 players you can press **Start game** and click through one round.

---

## Testing on your own with test bots

The game needs at least 4 players. To test alone, press **🤖 Add 5 test bots** in the host lobby (press it again for more). Bots are simulated students run by the host page: they answer tasks (about 70% correct), Innovator bots spread the variant, and all bots vote. Join from your phone as one real player, shorten the timers in Settings, and play a full game. Press **Remove bots** before your real class.

> **Firebase rules updated again** (new `pos`, `voice` and `voiceIdx` sections for the map and voice notes). If you pasted the rules before, paste the new `database.rules.json` again and click Publish.
>
> If you pasted the Firebase rules before this version, paste the new `database.rules.json` again (Firebase → Realtime Database → Rules → Publish), so that the host is allowed to act for the bots.

## Running it in class (suggested 90-minute session)

| Time | What happens |
|---|---|
| 0–10 min | Brief intro: speaker innovation, how changes spread. Show the host lobby; students scan the QR code and join. |
| 10–15 | Press **Start game**. Students secretly read their role card and character card. Explain the map: network groups, close-knit vs loose-knit, link-persons (↔). |
| 10–15 (cont.) | Model it once: chat with a student in character for 30 seconds using the variant, then swap chat codes. |
| 15–65 | Play 3 rounds (about 16 min each; set **Max rounds** to 3 in Settings for a 90-minute class). The host page moves to the next phase automatically when the timer runs out. Use **+30 s** or the **Next ▸** button whenever you like. |
| 60–85 | **Debrief** on the projector: the curve vs the S-curve, adoption by network and age group, who passed it to whom, and the six discussion questions. |
| 85–90 | Exit ticket: "Explain one Chapter 9 concept using something that happened in the game." |

**Tips**
- Choose the variant in **Settings** ("Variant students speak"), or leave it on Random. th-fronting and "glim" are the easiest for students to hear.
- Make space to walk around. After tapping 💬 Talk, students should physically go to the person they chat with. If your room is crowded, let them chat with neighbours only.
- Movement needs a steady connection: positions update about 4 times a second. One 90-minute class uses roughly 0.3–0.5 GB of Firebase's free 10 GB per month, so even daily use stays free.
- Test bots walk around the map too. They walk up to people (including you) and start chats, so you can try the whole flow alone.
- Keep the host tab open for the whole game: it runs the game logic. If you refresh it by accident, choose **Resume game**.
- Settings (in the lobby): the game uses about 1 Innovator per 6 players automatically (max = the Innovators setting). Lower the research target if your class answers slowly. Lengthen the meeting if discussion is good.
- Students who are voted out can still answer fieldwork tasks, but they can't vote.
- Phones that sleep reconnect by themselves. If a student closes the page, they can reopen the same link on the same phone and continue.
- After class you can delete old games in Firebase: Realtime Database → Data → hover over `games` → 🗑.

## Changing the questions

Open `js/questions.js` on GitHub and click ✏️. Each question looks like this:

```js
{ id: "t2", topic: "Apparent vs real time", q: "Question text…", o: ["option A", "option B", "option C", "option D"], a: 1, why: "Feedback shown after answering." },
```

`a` is the position of the correct option, **counting from 0** (so `a: 1` means option B). Each `id` must be unique. Options are shuffled on each student's phone automatically. You can reuse the game for other chapters just by replacing the questions.

## Troubleshooting

| Problem | Fix |
|---|---|
| Yellow "Demo mode" banner still showing | `js/config.js` is empty, or GitHub hasn't updated yet (wait 2 minutes, then hard-refresh). |
| "Could not sign in to Firebase" | Anonymous sign-in isn't enabled (step 2.4), or the domain isn't authorized (step 2.5). |
| Students see "Room not found" | Check the code. Make sure students use the same site address as the host. |
| Nothing updates / "permission denied" in the browser console | The rules weren't published (step 2.3), or `databaseURL` is wrong. |
| The internet fails in class | Open `printable.html` and use the paper version (print it in advance!). |
