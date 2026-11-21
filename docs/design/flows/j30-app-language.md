# FS-j30: App language

| Item | Value |
|---|---|
| Journey | j30, "Bahasa aplikasi", App language |
| PRD features | F-20 (also F-03, F-06, F-15, F-16) |
| Safety rules | SR-2, SR-5, SR-7 |
| Prototype source | Brief sections 24 (24.1-24.8), 24.9 (one file per language), 24.10 (fixes), 24.6 (words); `js/language.js`, `js/lang/en.js`, `js/lang/id.js`, `js/screens/preferences.js`, `js/screens/chat.js` (`indonesian()`, `english()`), `js/guide.js` (j30), `tools/lang-check.mjs` |
| Status | In the prototype (version 9); the real parts are Not in the prototype yet: the shared package `packages/i18n`, the agent following the language by a standing instruction, FlowDriven's lines in the runner (posted lines, notifications, menu bar) in the chat's or app language, dates and numbers with `Intl`, the language check in `pnpm check`, and `docs/translating.md` |

## Goal

The person reads FlowDriven in English (the default) or Bahasa Indonesia and can switch at any time. FlowDriven's own words change at once; what people and agents wrote keeps its words. In a chat the assistant answers in the language the person writes in. A contributor adds a language with one file and one line.

## Entry points and trigger

- Settings, "Language" (right under "Appearance"): one radio per language, each written in its own language ("English", "Bahasa Indonesia"), and the line "Chats and flows keep the words they were written in. FlowDriven answers in the language you write in."
- The first launch screen (FS-j01) shows the same options, small, above the heading.
- Trigger: the person's own click. Typed text, the operating system's language, a flow, a skill or outside text never changes the setting (SR-2).

## Preconditions

- None. The setting works with no agent set up and with the permission off.

## Main path

1. **FS-j30.S1 Choose Bahasa Indonesia.**
   - Person: opens Settings, chooses "Bahasa Indonesia".
   - FlowDriven: the renderer calls `settings.update {language: "id"}`; the runner saves it and writes an audit record (`setting_changed`, source `window`). The renderer sets the window's `lang` to `id` and draws every FlowDriven word from the Indonesian file of `packages/i18n`. The route, the open chat, the drafts, the color mode and the view state stay as they are. No run restarts.
   - Sees: the menu "Chat baru", "Cari", "Flow", "Aktivitas", "Skill", "Memori", "Toko flow", "HP & bot", "Pengaturan"; buttons such as "Jalankan", "Hentikan", "Setujui", "Tolak"; statuses such as "Berjalan", "Selesai", "Gagal"; the Language line "Chat dan flow tetap memakai kata-kata saat dibuat. FlowDriven menjawab dalam bahasa yang Anda pakai." What the person or an agent wrote (chats, flow names and steps, reports, memory items, skill and listing descriptions) keeps its words.
2. **FS-j30.S2 Write English in a new chat.**
   - Person: chooses "Chat baru" and types "run the weekly supplier report".
   - FlowDriven: a new chat starts with the app language `id`. The chat turn (FS-j20) returns the language `en` for the person's message, and FlowDriven sets the chat's language to `en`. The assistant's reply is English. The lines FlowDriven posts in this chat follow the chat's language. Cards, chips and buttons follow the app language.
   - Sees: the reply and lines in English ("Starting Weekly supplier report."), while the run card, its buttons ("Hentikan") and its status words stay Indonesian.
3. **FS-j30.S3 Dates and numbers.**
   - Person: reads a run's answer and the activity times.
   - FlowDriven: formats with `Intl` in the right language: dates as a short weekday, day and month, clock times in the 24-hour form, durations through one helper with words from the `time` group, and numbers with the language's marks. Data keeps the short form ("2h", `13:00`, codes).
   - Sees: in an English run "Thu 19 Nov", "13:00-15:00 (2h)", "1,240 users"; in an Indonesian run "Kam 19 Nov", "13:00-15:00 (2 jam)", "1.240 pengguna", and a duration of 90 minutes as "1 jam 30 menit". A run keeps the language of the chat it started in; a start outside a chat uses the app language.
4. **FS-j30.S4 Switch back.**
   - Person: opens Settings and chooses "English".
   - FlowDriven: as S1 with `en`. Nothing the person or an agent wrote is rewritten, and lines FlowDriven already posted keep the language they were posted in.
   - Sees: every FlowDriven word in English again, and the Indonesian chat unchanged.

## Other paths

- **FS-j30.P1 First launch.** On the first launch screen the person can choose a language before reading on. English is chosen until the person says otherwise, whatever the operating system's language is.
- **FS-j30.P2 The chat's language.** A new chat starts with the app language; so does a chat FlowDriven starts itself (the 17:00 question, an "after" question). A typed message sets the chat's language to the language the turn reports, if it is a registered language. A message that reads as neither ("ok", a number, a name) keeps it. Clicking a chip or a button never changes it. Text from outside, an agent's report and a run's answer never change it.
- **FS-j30.P3 Which words follow which language.** Follows the chat's language: the lines FlowDriven posts itself: the scheduled question and its lead, "<flow> needs a few details.", "<flow> finished, so <next> is next.", "Starting <flow>: ...", "Done. The report is in Activity.", "Okay, I won't start it.", and the parser messages of FS-j27.E3. A button name inside such a line is written as it reads on screen, so "Isi form di atas, lalu pilih Start." in an Indonesian chat with an English app. Follows the app language: menus, buttons, labels, statuses, dialogs, cards, form legends, notes, errors and example placeholders (the form is drawn in the app language at the moment it is shown), chips, the composer, Settings, system notifications, the menu bar menu, and messages to a paired phone. Keeps its words: everything a person, an agent or a flow author wrote, including a flow's answer template (only its date, time and duration values follow the run's language).
- **FS-j30.P4 Chips by code.** A chip or button is a card action with a code (`use_form`, `use_last_answers`, `cancel_question`, `suggestion`), not a sentence matched in the next message, so it works the same in every language and never sets the chat's language. A suggested answer such as "2 hours, built the login page" is sent as the person's message but does not change the chat's language.
- **FS-j30.P5 The agent follows the person.** Each chat turn carries one standing instruction: "Answer in the language the person writes in. If you cannot tell, use <app language name>." The turn reports a language code. FlowDriven keeps it only if it is a registered code. Other agent steps in a run are not changed by the setting.
- **FS-j30.P6 Every language added.** Settings and the first launch screen list every registered language by its own name, English first and then in the order of the list. A stored code that is not in the list counts as English. A language with missing words shows English for them.
- **FS-j30.P7 A contributor adds a language (B-31, `docs/translating.md`).** 1) Copy `packages/i18n/src/en.ts` to `packages/i18n/src/<code>.ts`. 2) Set `code` and `name` (written in the language itself). 3) Translate the values, keep the keys and every `{placeholder}`, and give each count the plural forms the language needs. 4) Add one line for the file to `packages/i18n/src/languages.ts`. 5) Run `pnpm check`: it lists missing keys, wrong placeholders and missing plural forms. Missing words show English until translated. 6) Optionally add a short style note at the top of the file.
- **FS-j30.P8 Asking the assistant to switch.** "Switch to Indonesian" gets a short answer and a card "Open Settings". The assistant has no intent that changes the language.
- **FS-j30.P9 Words from data.** Statuses, touch rules and result kinds are stored as codes and drawn through the `status.*` words, so each code has words in every complete language. A FlowDriven sentence is never stored in data other than as a chat message the person can read in the language it was posted in.
- **FS-j30.P10 Indonesian word rules.** Indonesian follows brief 24.6 and 24.10: plain words, "Anda", the fixed words of the table ("Chat baru", "Jalankan", "Setujui", "Perlu Anda"), the loanwords flow, chat, skill, timesheet, email, login, link, file, folder, upload, build, APK and form, clock times as "jam 17:00" (never "pukul"), durations "2 jam", "30 menit" and "1 jam 30 menit", "Menunggu Anda" for waiting for you, "Menunggu persetujuan" only for `waiting_approval` and "Perlu Anda" only for the needs-you list, a run is "proses", and numbers in the language's format.

## States

| Entity | From -> to | Cause |
|---|---|---|
| `language` setting | `en` <-> `id` (or any registered code) | The person chooses a radio |
| Chat language | none -> app language | The chat is created, by the person or by FlowDriven |
| Chat language | one code -> another | The person types a message and the turn reports a registered code |
| Window `lang` | old code -> new code | The setting changes |
| Language list | n codes -> n+1 codes | A language file is added to `languages.ts` |

## Decisions and confirmations

- Asks: nothing. A language change has no dialog and no second click; it can be undone with one click.
- Confirms: nothing.
- Does not change: any flow, its hash or its confirmed state (SR-3), any chat, report or memory item, any permission, rule or schedule. Only the person's click changes the setting (SR-2). The assistant can show a card that opens Settings, nothing more. `settings.update` is not exposed over MCP.
- Text from outside never sets a language and never adds a language file (SR-5).

## Errors and edge cases

- **FS-j30.E1 Agent not set up or signed out.** Cause: the agent is not ready. Person sees: the setting works as usual; lines such as "Claude Code needs you to sign in." come from the language file. A chat keeps the language it had.
- **FS-j30.E2 Permission off.** Cause: the switch is off. Person sees: the setting works; the line "FlowDriven may not run your AI agents. Turn this on in Settings." follows the app language.
- **FS-j30.E3 Missing or invalid language.** Cause: a stored code that is not registered, or an agent that reports an unregistered code. Person sees: English and `lang="en"` for the stored code; the chat keeps its current language for the agent's code. A word missing in a language shows in English, never as a key. A key missing in English cannot ship: the language check fails (A11).
- **FS-j30.E4 Limits reached.** Cause: none; a language change is free. Chat turns have the limits of FS-j20.E4.
- **FS-j30.E5 A stopped or failed run, or a failed save.** Cause: `settings.update` fails. Person sees: "Could not save. Try again." and the radio returns to its old value. Runs are never touched by the setting.
- **FS-j30.E6 Crash or restart.** The setting is in the store and survives. The renderer reads it before it paints; if the runner is not reachable it uses English. Chat languages are in the store.
- **FS-j30.E7 A flow changed since it was confirmed.** Not caused here: the language is not part of a flow's content, so no flow becomes "Changed: confirm again".
- **FS-j30.E8 Computer asleep, or FlowDriven closed, at a scheduled time.** A chat that FlowDriven starts at that time uses the app language at that moment. A notification uses the app language at the moment it is made.
- **FS-j30.E9 Outside text.** Cause: a pasted email or a page in another language, or a skill that says "answer in French". Person sees: no change. The chat's language comes from the person's own message; the standing instruction is FlowDriven's. A run's answer in another language never changes the chat's language.
- **FS-j30.E10 A decision that expires.** Not caused here. A decision card shows in the app language, and its title, if it came from a flow, keeps the flow author's words.
- **FS-j30.E11 Prototype gaps.** The prototype built its sample content in one language and offered "Mulai ulang prototype" to rebuild it; the real app has no sample and nothing to restart. The prototype found flows by an English and an Indonesian name and understood both languages with word lists; the real app has one name per flow and the agent reads the sentence. The prototype matched the Indonesian chip "Hanya kali ini" as a yes (a word list matched "ya" inside it); in the real app no sentence in any language accepts a card's offer, only its button does (FS-j20.A18). The Guide stayed Indonesian in both modes; that is the prototype's own text.

## Data read and written

- Reads: `Settings.language`, the registered languages (static files of `packages/i18n`), `Chat.language`, the clock and the person's time zone (for dates).
- Writes: `settings.language`, `chats.language` (at creation and when a turn reports another registered code), `AuditRecord` (`setting_changed`).
- Never written: a FlowDriven sentence as data other than chat messages; a language code from outside text.

## Runner API used

`settings.get`, `settings.update {language}`, `chats.create`, `chats.send`, `chats.act` (actions `use_form`, `use_last_answers`, `cancel_question`, `suggestion`), `chats.get`. Topics: `settings`, `chats`. The renderer sets the window `lang` itself. No other operation is involved.

## Acceptance criteria

- **FS-j30.A1** With no stored value the language is `en` and the window `lang` is `en`, whatever the operating system's language; nothing picks another language by itself. A stored code that is not registered counts as `en`.
- **FS-j30.A2** Settings and the first launch screen list every registered language by its own name, English first, in the order of the list.
- **FS-j30.A3** Choosing a language applies at once to menus, buttons, labels, statuses, dialogs, cards, chips and Settings; the route, the open chat, the drafts, the color mode and the view state stay; the window `lang` follows; the choice is saved and survives a restart; an audit record is written.
- **FS-j30.A4** Chats, flows, reports, memory items and skill and listing descriptions keep their words; changing the language rewrites none of them and restarts no run.
- **FS-j30.A5** Every chat turn carries the standing instruction with the app language as the fallback; a language code that is not registered is ignored.
- **FS-j30.A6** A new chat, and a chat FlowDriven starts, begin with the app language; a typed message sets the chat's language from the turn; "ok", a number, a chip, a button, an agent's report and a run's answer keep it.
- **FS-j30.A7** The lines FlowDriven posts in a chat follow the chat's language, with button names as they read on screen; cards, chips, buttons, form legends, notes, errors and example placeholders follow the app language at the moment they are shown.
- **FS-j30.A8** Dates, clock times, durations and numbers are formatted with `Intl` through one helper per kind, in the language of the chat or run (for a run) or of the app (elsewhere), in the person's time zone, including `Asia/Jakarta` near midnight and a daylight-saving change; data keeps "2h" and `13:00`.
- **FS-j30.A9** Chips and buttons are card actions by code, so they work in every language and never set the chat's language.
- **FS-j30.A10** There is one words file per language in `packages/i18n/src`; `en.ts` is the source and its type gives the keys; other languages are partial copies; one list imports them; a missing word shows English; `{name}` placeholders are filled and unknown braces stay; counts use plural forms from `Intl.PluralRules`.
- **FS-j30.A11** The language check, part of `pnpm check`, fails on: a key used in code but missing in English, an English key never used, a language with a key English lacks, a changed `{placeholder}`, a missing plural form, an Indonesian key that is missing, and a language file that is not in the list, and a hidden or format character in a language file; it passes on the real tree.
- **FS-j30.A12** A test language with two words, added the way `docs/translating.md` says, passes the check, appears in the list by its own name and shows English for the rest.
- **FS-j30.A13** Every run state, step state, decision state and touch rule code has words under `status.*` in English and Indonesian; data stores the codes.
- **FS-j30.A14** Indonesian uses the fixed words of brief 24.6 and the rules of 24.10 (clock times "jam 17:00", durations "2 jam" and "1 jam 30 menit", "Menunggu Anda", numbers "1.240").
- **FS-j30.A15** The assistant has no intent that changes the language; "switch to Indonesian" shows a card that opens Settings; `settings.update` is not exposed over MCP.
- **FS-j30.A16** System notifications and the menu bar menu use the app language at the moment they are made.
- **FS-j30.A17** Language files may hold any letters but no hidden or format characters; the hidden-character check scans them.
- **FS-j30.A18** A failed save shows "Could not save. Try again." and restores the radio.

## Not in the prototype yet

- The shared package `packages/i18n` and its files; the check in `pnpm check`; `docs/translating.md`; `Intl` dates and numbers; the standing instruction to the agent and the language the turn reports; FlowDriven's lines coming from the runner in the chat's language; notifications and menu bar in the app language; the failed-save line.

## Drafter's calls

- Word keys are grouped as brief 24.9.1 lists (`common`, `time`, `status`, `rail`, `settings`, `chat`, `flows`, `schedule`, `activity` and the rest) with short camelCase names. The tests of this journey name a few keys (for example `rail.newChat`, `time.hoursShort`, `status.waiting_approval`); the build must use them.
- The shared package replaces brief 24.8's `apps/desktop/src/i18n/en.ts`, because the runner, the renderer and the tests need the same words (AD-14).
- A chip or button is a card action by code. A suggested answer is sent through `chats.act` with the action `suggestion` so it cannot set the chat's language. Reason: brief 24.10 says suggested replies are matched by a code and a click never changes the language.
- The language check is a Vitest test in `packages/i18n/src/check.test.ts` over a function `checkLanguages` in `packages/i18n/src/check.ts`, not a script in `tools/checks/`. Reason: it runs inside `pnpm check` without editing `tools/checks/`, which is an Ask-first area.
- The renderer waits for `settings.get` before it paints and falls back to English if the runner is not reachable. Reason: no flash of the wrong language, and no extra file for main.
- Clock times are always in the 24-hour form in both languages, as the prototype showed.
- A flow's answer template is the flow author's words; only the date, time and duration values in it follow the run's language. Reason: format 1.2 has one answer text per flow.
- Money amounts keep the dollar form ("$9.20") in both languages; only plain numbers follow the language's marks. Reason: brief 24.10 names plain numbers only.
