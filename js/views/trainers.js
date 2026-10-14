import { el, field, typePill } from "../components.js";
import { loadSave, writeSave, newMon } from "../storage.js";
import { pingTrainer, listTrainers, getTrainerTeam, sendToTrainer, getInbox, ackInbox, sendNoteToDm } from "../network.js";
import { registerInterval } from "../intervals.js";
import { getHiddenTrainerIds, hideTrainerId, unhideTrainerId } from "../hiddenTrainers.js";

const POLL_MS = 4000;

function monSummary(state, mon) {
  const species = state.pokemonByName.get(mon.name);
  return el("div", { class: "card" }, [
    el("div", { class: "detail-header" }, [
      el("span", { class: "name" }, mon.nickname || mon.name || "?"),
      species ? el("span", {}, [typePill(species.type1), species.type2 ? typePill(species.type2) : null].filter(Boolean)) : null,
    ].filter(Boolean)),
    el("table", { class: "kv-table" }, [
      ["Species", mon.name || "—"], ["Level", mon.level], ["HP", mon.currentHp ?? "—"],
      ["Ability", mon.ability || "—"], ["Item", mon.item || "—"], ["Status", mon.status || "None"],
      ["Moves", mon.moves.filter(Boolean).join(", ") || "—"],
    ].map(([k, v]) => el("tr", {}, [el("td", {}, k), el("td", {}, String(v))]))),
  ]);
}

export function renderTrainersOnline(container, state) {
  container.innerHTML = "";
  container.appendChild(el("h1", { class: "view-title" }, "Trainers Online"));

  const save = loadSave();
  const myId = save.networkId;
  let myName = save.trainer.name || "Trainer";

  const nameInput = el("input", { type: "text", value: save.trainer.name, placeholder: "Enter your trainer name…" });
  nameInput.addEventListener("input", () => {
    save.trainer.name = nameInput.value;
    myName = nameInput.value || "Trainer";
    writeSave(save);
  });
  container.appendChild(el("div", { class: "card" }, [field("Your Trainer Name (shown to others)", nameInput)]));

  const dmNoteInput = el("input", { type: "text", placeholder: "e.g. Can we take a short rest?" });
  const dmNoteBtn = el("button", { class: "btn secondary" }, "Send to DM");
  dmNoteBtn.addEventListener("click", async () => {
    if (!dmNoteInput.value.trim()) return;
    await sendNoteToDm(myName, dmNoteInput.value.trim());
    dmNoteInput.value = "";
    dmNoteBtn.textContent = "Sent ✓";
    setTimeout(() => { dmNoteBtn.textContent = "Send to DM"; }, 1200);
  });
  container.appendChild(el("div", { class: "card" }, [
    el("h4", {}, "Message the Dungeon Master"),
    el("div", { class: "grid-2" }, [dmNoteInput, dmNoteBtn]),
  ]));

  const statusLine = el("p", { class: "view-sub" }, "Connecting…");
  container.appendChild(statusLine);

  const inboxCard = el("div", { class: "card" });
  container.appendChild(el("h4", {}, "Inbox"));
  container.appendChild(inboxCard);

  container.appendChild(el("h4", {}, "Online Now"));
  const listWrap = el("div", { class: "card-grid" });
  container.appendChild(listWrap);
  const hiddenWrap = el("div");
  container.appendChild(hiddenWrap);

  const expanded = new Set();   // trainer ids currently showing their team
  const teamCache = new Map();  // trainer id -> {name, team}
  const sendOpenFor = { id: null };
  // Keeps the open Send… panel's actual DOM node (and so its typeSelect
  // choice + whatever's typed into it) alive across the 4s poll tick below —
  // renderList() used to call sendForm(t) fresh every single poll, silently
  // resetting the dropdown back to "Pokémon" and wiping any note text an
  // in-progress message wasn't fast enough to beat the next poll to (the
  // "notes turn into a Pokémon send" bug).
  const sendFormCache = new Map(); // trainer id -> the sendForm() element
  let lastOthers = []; // most recent full (unfiltered) online list, for the hidden-trainers panel

  function myTeamPayload() {
    return { party: save.party, pc: save.pc };
  }

  async function renderInbox() {
    const messages = await getInbox(myId);
    inboxCard.innerHTML = "";
    if (!messages.length) {
      inboxCard.appendChild(el("p", { class: "view-sub" }, "Nothing waiting for you."));
      return;
    }
    messages.forEach((m) => {
      const desc = m.type === "pokemon" ? `a Pokémon: ${m.payload?.nickname || m.payload?.name || "?"}`
        : m.type === "cash" ? `£${m.payload?.amount ?? 0} cash`
        : `a note: "${m.payload?.text || ""}"`;
      const acceptBtn = el("button", { class: "btn" }, m.type === "note" ? "OK" : "Accept");
      acceptBtn.addEventListener("click", async () => {
        if (m.type === "pokemon" && m.payload) {
          const mon = { ...newMon(), ...m.payload, id: newMon().id };
          if (save.party.length < 6) save.party.push(mon); else save.pc.push(mon);
        } else if (m.type === "cash") {
          save.trainer.cash = (Number(save.trainer.cash) || 0) + (Number(m.payload?.amount) || 0);
        }
        writeSave(save);
        await ackInbox(myId, [m.id]);
        renderInbox();
      });
      const dismissBtn = el("button", { class: "btn secondary" }, "Dismiss");
      dismissBtn.addEventListener("click", async () => { await ackInbox(myId, [m.id]); renderInbox(); });
      inboxCard.appendChild(el("div", { class: "card", style: "margin-bottom:8px" }, [
        el("p", {}, [el("strong", {}, m.fromName || "A trainer"), ` sent you ${desc}`]),
        el("div", { class: "grid-2" }, [acceptBtn, dismissBtn]),
      ]));
    });
  }

  function sendForm(trainer) {
    const typeSelect = el("select", {}, ["Pokémon", "Cash", "Note"].map((o) => el("option", { value: o }, o)));
    const body = el("div");

    function renderBody() {
      body.innerHTML = "";
      if (typeSelect.value === "Pokémon") {
        const options = [...save.party, ...save.pc].filter((m) => m.name);
        if (!options.length) { body.appendChild(el("p", { class: "view-sub" }, "You have no Pokémon with a species set yet — set one up in My Team first.")); return; }
        const monSelect = el("select", {}, options.map((m, i) => el("option", { value: i }, `${m.nickname || m.name} (Lv.${m.level})`)));
        const sendBtn = el("button", { class: "btn" }, `Send to ${trainer.name}`);
        sendBtn.addEventListener("click", async () => {
          const mon = options[Number(monSelect.value)];
          await sendToTrainer({ fromId: myId, fromName: myName, toId: trainer.id, type: "pokemon", payload: mon });
          sendBtn.textContent = "Sent!";
        });
        body.appendChild(el("div", { class: "grid-2" }, [monSelect, sendBtn]));
      } else if (typeSelect.value === "Cash") {
        const amountInput = el("input", { type: "number", min: "0", value: "50" });
        const sendBtn = el("button", { class: "btn" }, `Send to ${trainer.name}`);
        sendBtn.addEventListener("click", async () => {
          await sendToTrainer({ fromId: myId, fromName: myName, toId: trainer.id, type: "cash", payload: { amount: Number(amountInput.value) || 0 } });
          sendBtn.textContent = "Sent!";
        });
        body.appendChild(el("div", { class: "grid-2" }, [field("Amount (£)", amountInput), sendBtn]));
      } else {
        const textInput = el("input", { type: "text", placeholder: "e.g. Meet at the Pokémon Center" });
        const sendBtn = el("button", { class: "btn" }, `Send to ${trainer.name}`);
        sendBtn.addEventListener("click", async () => {
          await sendToTrainer({ fromId: myId, fromName: myName, toId: trainer.id, type: "note", payload: { text: textInput.value } });
          sendBtn.textContent = "Sent!";
        });
        body.appendChild(el("div", { class: "grid-2" }, [textInput, sendBtn]));
      }
    }
    typeSelect.addEventListener("input", renderBody);
    renderBody();
    return el("div", { class: "card", style: "margin-top:8px" }, [field("Send", typeSelect), body]);
  }

  async function renderList() {
    const all = await listTrainers(myId);
    if (all === null) {
      statusLine.textContent = "Couldn't reach the server for trainer sync — the calculators still work offline.";
      return;
    }
    lastOthers = all;
    const hidden = getHiddenTrainerIds();
    const others = all.filter((t) => !hidden.has(t.id));
    const hiddenCount = all.length - others.length;
    statusLine.textContent = (others.length
      ? `${others.length} other trainer${others.length === 1 ? "" : "s"} online.`
      : "No other trainers online right now — have them open this same app URL.")
      + (hiddenCount ? ` (${hiddenCount} hidden)` : "");

    listWrap.innerHTML = "";
    others.forEach((t) => {
      const viewBtn = el("button", { class: "btn secondary" }, expanded.has(t.id) ? "Hide Team" : "View Team");
      const sendBtn = el("button", { class: "btn secondary" }, sendOpenFor.id === t.id ? "Cancel" : "Send…");
      const removeBtn = el("button", { class: "btn secondary" }, "✕ Remove");
      viewBtn.addEventListener("click", async () => {
        if (expanded.has(t.id)) expanded.delete(t.id);
        else { expanded.add(t.id); teamCache.set(t.id, await getTrainerTeam(t.id)); }
        renderList();
      });
      sendBtn.addEventListener("click", () => {
        sendOpenFor.id = sendOpenFor.id === t.id ? null : t.id;
        sendFormCache.delete(t.id); // (re)opening always starts from a clean form
        renderList();
      });
      removeBtn.addEventListener("click", () => {
        if (!confirm(`Remove ${t.name} from your list? Their own device/save is untouched — they'll only disappear from your view, and you can bring them back below.`)) return;
        hideTrainerId(t.id);
        renderList();
      });

      const card = el("div", { class: "card" }, [
        el("div", { class: "detail-header" }, [
          el("span", { class: "name" }, t.name),
          el("span", { class: "view-sub" }, `${t.partyCount} in party`),
          viewBtn, sendBtn, removeBtn,
        ]),
      ]);
      if (sendOpenFor.id === t.id) {
        if (!sendFormCache.has(t.id)) sendFormCache.set(t.id, sendForm(t));
        card.appendChild(sendFormCache.get(t.id));
      }
      if (expanded.has(t.id)) {
        const cached = teamCache.get(t.id);
        const teamWrap = el("div", { style: "margin-top:10px" });
        if (!cached) teamWrap.appendChild(el("p", { class: "view-sub" }, "Loading…"));
        else {
          const mons = [...(cached.team?.party || []), ...(cached.team?.pc || [])].filter((m) => m.name);
          if (!mons.length) teamWrap.appendChild(el("p", { class: "view-sub" }, "No Pokémon set up yet."));
          else mons.forEach((m) => teamWrap.appendChild(monSummary(state, m)));
        }
        card.appendChild(teamWrap);
      }
      listWrap.appendChild(card);
    });

    hiddenWrap.innerHTML = "";
    if (hiddenCount) {
      const hiddenList = all.filter((t) => hidden.has(t.id));
      hiddenWrap.appendChild(el("div", { class: "card" }, [
        el("h4", {}, `Hidden (${hiddenCount})`),
        el("div", { class: "grid-2" }, hiddenList.map((t) => {
          const unhideBtn = el("button", { class: "btn secondary" }, `Bring back ${t.name}`);
          unhideBtn.addEventListener("click", () => { unhideTrainerId(t.id); renderList(); });
          return unhideBtn;
        })),
      ]));
    }
  }

  async function tick() {
    await pingTrainer(myId, myName, myTeamPayload(), save.trainer.sprite);
    await Promise.all([renderList(), renderInbox()]);
  }

  tick();
  registerInterval(setInterval(tick, POLL_MS));
}
