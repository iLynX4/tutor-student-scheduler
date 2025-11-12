// App.jsx
import React, { useEffect, useMemo, useState } from "react";

/**
 * 🇭🇷 Tutor–Student Scheduler (Demo bez backenda)
 *
 * Sadrži:
 * - Perzistentnu "bazu" (localStorage)
 * - Prijavu (email/korisničko ime + lozinka) i odjavu
 * - Uloge: admin, tutor, student
 * - Tutor dodaje termine kao draft i objavljuje ih (“Potvrdi i pošalji”)
 * - Student vidi samo objavljene termine svog tutora i ne može rezervirati prošle
 * - Tutor može označiti termin kao “odrađeno”
 * - Admin vidi termine samo od odabranog tutora za aktivni dan
 * - Bojanje dana: zeleni dani s objavljenim slobodnim terminima; crveni kad su svi objavljeni termini rezervirani
 * - Objave (tutor/admin), student može sakriti sebi; notifikacije u aplikaciji + mock e-mail log
 * - Statistika (tjedna + kumulativna), veći grafovi u popupu, tablice u layoutu
 * - Stabilan layout (fiksne visine s internim scrollom, bez pomicanja drugih elemenata)
 */

/********************
 * Pomoćne funkcije *
 ********************/
const uid = () => Math.random().toString(36).slice(2, 10);

function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // 0=pon … 6=ned
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfWeek(weekStart) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 7);
  d.setHours(0, 0, 0, 0);
  return d;
}
function dateForWeekday(weekStart, weekdayIndex) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + weekdayIndex);
  return d;
}
function withTime(baseDate, hour, minute) {
  const d = new Date(baseDate);
  d.setHours(hour, minute, 0, 0);
  return d;
}
function fmtDay(d) {
  return d.toLocaleDateString("hr-HR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  });
}
function fmtRangeFromISO(iso) {
  const start = new Date(iso);
  const end = new Date(start.getTime() + 50 * 60 * 1000);
  const datePart = start.toLocaleDateString("hr-HR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
  const t = (d) => d.toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit" });
  return `${datePart} ${t(start)}–${t(end)}`;
}
function fmtWeekRange(weekStart) {
  const start = new Date(weekStart);
  const end = endOfWeek(weekStart);
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
  return `${fmt(start)}–${fmt(end)}`;
}
function isPastWeek(weekStart) {
  const todayWeek = startOfWeek(new Date());
  return weekStart < todayWeek;
}
function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-zčćđšž0-9\s.@-]/g, "")
    .replace(/\s+/g, ".");
}

/*****************
 * Seed podaci   *
 *****************/
const seedIds = {
  admin: uid(),
  t1: uid(),
  t2: uid(),
  s1: uid(),
  s2: uid(),
};
const seedUsers = [
  { id: seedIds.admin, role: "admin", name: "Admin", username: "admin", email: "admin@uni.hr", password: "admin123" },
  { id: seedIds.t1, role: "tutor", name: "Ivana Tutor", username: "ivana", email: "ivana@uni.hr", password: "test123" },
  { id: seedIds.t2, role: "tutor", name: "Marko Mentor", username: "marko", email: "marko@uni.hr", password: "test123" },
  { id: seedIds.s1, role: "student", name: "Ana Student", username: "ana", email: "ana@uni.hr", password: "test123" },
  { id: seedIds.s2, role: "student", name: "Petar Polaznik", username: "petar", email: "petar@uni.hr", password: "test123" },
];

/***********************
 * "Stalna baza" (LS)  *
 ***********************/
const DB_KEY = "tss_db_v1";
const SESS_KEY = "tss_session_uid";

function createInitialDB() {
  const tutors = seedUsers.filter((u) => u.role === "tutor");
  const students = seedUsers.filter((u) => u.role === "student");
  const assignments = {};
  let i = 0;
  for (const s of students) assignments[s.id] = tutors[i++ % tutors.length].id;

  return {
    users: seedUsers,
    assignments, // studentId -> tutorId
    // slot: {id, tutorId, when: ISO, reservedBy?: studentId, done:boolean, published:boolean}
    slots: [],
    announcements: [], // {id, tutorId, title, body, createdAt, recipients:[], readBy:[]}
    notifications: {}, // userId -> []
    emailLog: [],
    lastWeeklyResetAt: null,
    hiddenAnnouncements: {}, // userId -> [announcementId...]
  };
}

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return createInitialDB();
    const db = JSON.parse(raw);
    db.hiddenAnnouncements = db.hiddenAnnouncements || {};
    db.emailLog = db.emailLog || [];
    db.notifications = db.notifications || {};
    db.announcements = db.announcements || [];
    db.slots = (db.slots || []).map((s) => ({ published: false, done: false, reservedBy: null, ...s }));
    db.users = (db.users || []).map((u) => ({ username: "", password: "", ...u }));
    return db;
  } catch {
    return createInitialDB();
  }
}
function saveDB(db) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {/* ignore */}
}
let saveTimer = null;
function scheduleSave(db) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveDB(db), 200);
}

/***********************
 * In-memory "store"    *
 ***********************/
const createStore = () => loadDB();

/***********************
 * Event bus (local)    *
 ***********************/
const subscribers = new Set();
function publish(evt) {
  subscribers.forEach((fn) => fn(evt));
}

/***********************
 * EMAIL (mock)         *
 ***********************/
function sendEmail(store, to, subject, body) {
  store.emailLog.unshift({ id: uid(), to, subject, body, at: new Date().toISOString() });
}

/********************************
 * In-app notifikacije (local)   *
 ********************************/
function pushNotif(store, userId, payload) {
  if (!store.notifications[userId]) store.notifications[userId] = [];
  store.notifications[userId].unshift({
    id: uid(),
    read: false,
    createdAt: new Date().toISOString(),
    ...payload,
  });
  publish({ type: "notification:new", userId });
}

/*****************************
 * Glavna aplikacija          *
 *****************************/
export default function App() {
  const [store] = useState(createStore);
  const [currentUser, setCurrentUser] = useState(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  // Re-render + autosave
  const [, force] = useState(0);
  useEffect(() => {
    const sub = () => {
      scheduleSave(store);
      force((x) => x + 1);
    };
    subscribers.add(sub);
    return () => subscribers.delete(sub);
  }, [store]);

  // Auto-prijava iz sessiona
  useEffect(() => {
    const uid = localStorage.getItem(SESS_KEY);
    if (uid) {
      const u = store.users.find((x) => x.id === uid);
      if (u) setCurrentUser(u);
    }
  }, [store]);

  // Weekly reset (interno, bez gumba)
  useEffect(() => {
    maybeWeeklyReset(store);
  }, [store]);

  const logout = () => {
    setCurrentUser(null);
    localStorage.removeItem(SESS_KEY);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-semibold">🎓 Tutor–Student Scheduler</h1>
          <div className="flex items-center gap-2">
            {currentUser && (
              <button
                className="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm"
                onClick={() => setEmailOpen((v) => !v)}
              >
                📧 Email log
              </button>
            )}
            {!currentUser ? (
              <button className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm" onClick={() => setLoginOpen(true)}>
                Prijava
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600">👤 {currentUser.name} ({currentUser.role})</span>
                <button className="px-3 py-1.5 rounded-lg bg-white border text-sm" onClick={logout}>
                  Odjava
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 grid gap-6">
        {currentUser ? (
          <>
            <WelcomeBar store={store} user={currentUser} />
            <div className="grid md:grid-cols-3 gap-6 items-start">
              <div className="md:col-span-2 grid gap-6">
                <WeekView store={store} user={currentUser} />
              </div>
              <aside className="grid gap-6">
                <NotificationsPanel store={store} user={currentUser} />
                <AnnouncementsPanel store={store} user={currentUser} />
              </aside>
            </div>
            {emailOpen && <EmailLog store={store} onClose={() => setEmailOpen(false)} />}
          </>
        ) : (
          <Landing />
        )}
      </main>

      <footer className="py-6 text-center text-sm text-slate-500">
        Demo verzija · podaci se spremaju lokalno (localStorage).
      </footer>

      {loginOpen && (
        <LoginModal
          store={store}
          onClose={() => setLoginOpen(false)}
          onSuccess={(u) => {
            setCurrentUser(u);
            localStorage.setItem(SESS_KEY, u.id);
          }}
        />
      )}
    </div>
  );
}

/****************
 * Komponente   *
 ****************/
function Landing() {
  return (
    <div className="mx-auto max-w-xl text-center py-16">
      <p className="text-4xl">👋</p>
      <h2 className="text-2xl font-semibold mt-2">Dobrodošli!</h2>
      <p className="mt-2 text-slate-600">
        Prijavite se gumbom gore desno i isprobajte aplikaciju kao admin, tutor ili student.
        (Demo lozinke: admin123 / test123)
      </p>
    </div>
  );
}

function WelcomeBar({ store, user }) {
  const unread = (store.notifications[user.id]?.filter((n) => !n.read)?.length) || 0;
  return (
    <div className="p-4 rounded-2xl bg-white border border-slate-200 flex items-center justify-between">
      <div>
        <div className="text-sm text-slate-500">Prijavljeni kao</div>
        <div className="text-lg font-semibold">
          {user.name} <span className="text-slate-400">({user.role})</span>
        </div>
      </div>
      <div className="text-sm text-slate-600">
        🔔 Nepročitanih obavijesti: <b>{unread}</b>
      </div>
    </div>
  );
}

/***********************************
 * Lokalni tjedni pregled po ulozi *
 ***********************************/
function WeekView({ store, user }) {
  const [weekStart, setWeekStart] = useState(startOfWeek());
  const [activeDay, setActiveDay] = useState(0);

  const role = user.role;

  return (
    <>
      <WeekNav weekStart={weekStart} setWeekStart={setWeekStart} />
      <WeekGrid store={store} user={user} weekStart={weekStart} activeDay={activeDay} setActiveDay={setActiveDay} />

      {role === "student" && (
        <StudentPanel store={store} student={user} weekStart={weekStart} activeDay={activeDay} />
      )}
      {role === "tutor" && <TutorPanel store={store} tutor={user} weekStart={weekStart} activeDay={activeDay} />}
      {role === "admin" && <AdminPanel store={store} admin={user} weekStart={weekStart} activeDay={activeDay} />}
    </>
  );
}

function WeekNav({ weekStart, setWeekStart }) {
  const prev = () =>
    setWeekStart((d) => {
      const nd = new Date(d);
      nd.setDate(nd.getDate() - 7);
      return nd;
    });
  return (
    <div className="flex items-center justify-between">
      <div className="text-lg font-semibold">Tjedan {fmtWeekRange(weekStart)}</div>
      <div className="flex items-center gap-2">
        <button className="px-3 py-1.5 rounded-lg bg-white border hover:bg-slate-50" onClick={prev}>
          ⬅️ Prethodni
        </button>
        <button
          className="px-3 py-1.5 rounded-lg bg-white border hover:bg-slate-50"
          onClick={() => setWeekStart(startOfWeek())}
        >
          📅 Ovaj tjedan
        </button>
      </div>
    </div>
  );
}

/** Bojanje dana ovisno o terminima i rezervacijama */
function WeekGrid({ store, user, weekStart, activeDay, setActiveDay }) {
  const days = ["Pon", "Uto", "Sri", "Čet", "Pet", "Sub", "Ned"];
  const pastWeek = isPastWeek(weekStart);

  const visibleSlotsForDay = (dayDate) => {
    if (user.role === "student") {
      const tutorId = store.assignments[user.id];
      return store.slots
        .filter((s) => s.tutorId === tutorId && s.published)
        .filter((s) => sameDay(new Date(s.when), dayDate));
    }
    if (user.role === "tutor") {
      return store.slots
        .filter((s) => s.tutorId === user.id)
        .filter((s) => sameDay(new Date(s.when), dayDate));
    }
    return store.slots.filter((s) => s.published).filter((s) => sameDay(new Date(s.when), dayDate));
  };

  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((label, i) => {
        const d = dateForWeekday(weekStart, i);
        const isToday = new Date().toDateString() === d.toDateString();

        let base = "bg-white hover:bg-slate-50";
        let border = "border-slate-200";

        if (pastWeek) {
          base = "bg-rose-50";
          border = "border-rose-300 text-rose-700";
        } else {
          const slots = visibleSlotsForDay(d);
          if (slots.length > 0) {
            const allReserved = slots.every((s) => !!s.reservedBy);
            if (allReserved) {
              base = "bg-rose-50";
              border = "border-rose-300 text-rose-700";
            } else {
              base = "bg-emerald-50";
              border = "border-emerald-300 text-emerald-700";
            }
          }
        }

        const active = activeDay === i ? "border-indigo-500 ring-2 ring-indigo-100" : border;

        return (
          <button
            key={i}
            onClick={() => setActiveDay(i)}
            className={`rounded-2xl border p-4 text-center transition h-24 ${base} ${active}`}
          >
            <div className={`text-sm ${pastWeek ? "text-rose-700" : "text-slate-500"}`}>{label}</div>
            <div className="text-xl font-semibold">{String(d.getDate()).padStart(2, "0")}</div>
            {!pastWeek && isToday && <div className="text-[10px] text-green-600 mt-1">danas</div>}
            {pastWeek && <div className="text-[10px] text-rose-600 mt-1">prošli tjedan</div>}
          </button>
        );
      })}
    </div>
  );
}

/*****************
 * STUDENT PANEL *
 *****************/
function StudentPanel({ store, student, weekStart, activeDay }) {
  const tutorId = store.assignments[student.id];
  const tutor = store.users.find((u) => u.id === tutorId);
  const dayDate = dateForWeekday(weekStart, activeDay);

  const daySlots = useMemo(
    () =>
      store.slots
        .filter((s) => s.tutorId === tutorId && s.published)
        .filter((s) => sameDay(new Date(s.when), dayDate))
        .sort((a, b) => new Date(a.when) - new Date(b.when)),
    [store.slots, tutorId, dayDate]
  );

  const reserve = (slot) => {
    const now = new Date();
    if (new Date(slot.when) < now) {
      alert("Ne može se rezervirati prošli termin.");
      return;
    }
    if (!slot.published) {
      alert("Termin još nije objavljen.");
      return;
    }
    if (slot.reservedBy && slot.reservedBy !== student.id) {
      alert("Termin je već rezerviran.");
      return;
    }
    if (slot.reservedBy === student.id) {
      alert("Već ste rezervirali ovaj termin.");
      return;
    }
    slot.reservedBy = student.id;

    pushNotif(store, tutor.id, {
      type: "booking",
      title: "Nova rezervacija",
      message: `${student.name} je rezervirao/la termin ${fmtRangeFromISO(slot.when)}.`,
    });
    sendEmail(
      store,
      tutor.email,
      "Nova rezervacija termina",
      `${student.name} je rezervirao/la termin ${fmtRangeFromISO(slot.when)}.`
    );
    publish({ type: "slot:update" });
  };

  const removeMyAnnouncement = (a) => {
    if (!store.hiddenAnnouncements[student.id]) store.hiddenAnnouncements[student.id] = [];
    const arr = store.hiddenAnnouncements[student.id];
    if (!arr.includes(a.id)) arr.push(a.id);
    publish({ type: "announcement:hidden", id: a.id, userId: student.id });
  };

  return (
    <section className="grid gap-4">
      <Card title="Termini vašeg tutora">
        <div className="text-sm text-slate-600 mb-2">
          Prikazani su OBJAVLJENI termini vašeg tutora: <b>{tutor?.name}</b>.
        </div>
        {daySlots.length === 0 ? (
          <Empty>Na ovaj dan nema objavljenih termina.</Empty>
        ) : (
          <div className="grid gap-2 max-h-80 overflow-auto pr-1">
            {daySlots.map((s) => {
              const isReserved = !!s.reservedBy;
              const box = isReserved ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50";
              return (
                <div key={s.id} className={`flex items-center justify-between p-3 rounded-xl border ${box}`}>
                  <div>
                    <div className="font-medium">{fmtRangeFromISO(s.when)}</div>
                    <div className="text-xs text-slate-500">
                      Objavio tutor: {store.users.find((u) => u.id === s.tutorId)?.name}
                    </div>
                  </div>
                  <div>
                    {s.reservedBy ? (
                      s.reservedBy === student.id ? (
                        <span className="text-green-700 text-sm">✔️ Rezervirano (vi)</span>
                      ) : (
                        <span className="text-slate-600 text-sm">Zauzeto</span>
                      )
                    ) : (
                      <button className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm" onClick={() => reserve(s)}>
                        Rezerviraj
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Objave vašeg tutora">
        <StudentAnnouncementsList store={store} student={student} tutorId={tutorId} onHide={removeMyAnnouncement} />
      </Card>
    </section>
  );
}

function StudentAnnouncementsList({ store, student, tutorId, onHide }) {
  let items = store.announcements.filter((a) => a.tutorId === tutorId);
  const hiddenArr = store.hiddenAnnouncements[student.id] || [];
  const hidden = new Set(hiddenArr);
  items = items.filter((a) => !hidden.has(a.id));

  const open = (a) => {
    markAnnouncementRead(store, student.id, a.id);
    alert("📢 " + a.title + "\n\n" + a.body);
  };
  return items.length === 0 ? (
    <Empty>Nema objava.</Empty>
  ) : (
    <ul className="grid gap-2 max-h-64 overflow-auto pr-1">
      {items.map((a) => (
        <li key={a.id} className="p-3 rounded-xl border bg-white flex items-center justify-between">
          <div>
            <div className="font-medium">{a.title}</div>
            <div className="text-xs text-slate-500">{new Date(a.createdAt).toLocaleString("hr-HR")}</div>
          </div>
          <div className="flex items-center gap-2">
            {isAnnouncementRead(a, student.id) ? (
              <span className="text-xs text-slate-400">pročitano</span>
            ) : (
              <span className="text-xs text-indigo-600">novo</span>
            )}
            <button className="px-3 py-1.5 rounded-lg bg-white border" onClick={() => open(a)}>
              Otvori
            </button>
            <button className="px-3 py-1.5 rounded-lg bg-white border" onClick={() => onHide?.(a)}>
              Ukloni
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/***************
 * TUTOR PANEL *
 ***************/
function TutorPanel({ store, tutor, weekStart, activeDay }) {
  const dayDate = dateForWeekday(weekStart, activeDay);
  const [hh, setHh] = useState(10);

  const mySlots = store.slots
    .filter((s) => s.tutorId === tutor.id)
    .sort((a, b) => new Date(a.when) - new Date(b.when));
  const daySlots = mySlots.filter((s) => sameDay(new Date(s.when), dayDate));

  const pastWeek = isPastWeek(weekStart);

  const add = () => {
    if (pastWeek) {
      alert("Dodavanje onemogućeno za ovaj tjedan.");
      return;
    }
    const dt = withTime(dayDate, hh, 0);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (dt < todayStart) {
      alert("Ne možeš dodati termin u prošlom danu.");
      return;
    }
    const slot = { id: uid(), tutorId: tutor.id, when: dt.toISOString(), reservedBy: null, done: false, published: false };
    store.slots.push(slot);
    publish({ type: "slot:new", slot });
  };

  const canDeleteSlot = (s) => {
    if (tutor.role === "admin") return true;
    if (s.tutorId !== tutor.id) return false;
    return !s.reservedBy;
  };

  const deleteSlot = (s) => {
    if (!canDeleteSlot(s)) {
      alert("Nije dozvoljeno brisanje ovog termina.");
      return;
    }
    store.slots = store.slots.filter((x) => x.id !== s.id);
    publish({ type: "slot:delete", id: s.id });
  };

  const postAnnouncement = () => {
    const title = window.prompt("Naslov obavijesti:");
    if (!title) return;
    const body = window.prompt("Tekst obavijesti:") || "";

    const students = Object.entries(store.assignments)
      .filter(([sid, tid]) => tid === tutor.id)
      .map(([sid]) => sid);

    const a = {
      id: uid(),
      tutorId: tutor.id,
      title,
      body,
      createdAt: new Date().toISOString(),
      recipients: students,
      readBy: [],
    };
    store.announcements.unshift(a);

    students.forEach((sid) => {
      const stu = store.users.find((u) => u.id === sid);
      pushNotif(store, sid, { type: "announcement", title: "Nova objava: " + title, message: body.slice(0, 120) });
      sendEmail(store, stu.email, "Nova objava od tutora " + tutor.name + ": " + title, body);
    });

    publish({ type: "announcement:new", a });
  };

  // Objavi sve draft termine u AKTUALNOM TJEDNU
  const publishWeek = () => {
    if (pastWeek) return;

    const start = startOfWeek(weekStart);
    const end = endOfWeek(weekStart);
    const mineDraftThisWeek = store.slots.filter(
      (s) => s.tutorId === tutor.id && !s.published && new Date(s.when) >= start && new Date(s.when) < end
    );

    if (mineDraftThisWeek.length === 0) {
      alert("Nema draft termina za objavu u ovom tjednu.");
      return;
    }

    mineDraftThisWeek.forEach((s) => (s.published = true));

    const studentIds = Object.entries(store.assignments)
      .filter(([sid, tid]) => tid === tutor.id)
      .map(([sid]) => sid);

    const dayNames = new Set(
      mineDraftThisWeek.map((s) =>
        new Date(s.when).toLocaleDateString("hr-HR", { weekday: "long", day: "2-digit", month: "2-digit" })
      )
    );
    const msg =
      `Objavljeni su novi termini za tjedan ${fmtWeekRange(start)}.\n` +
      `Dani: ${Array.from(dayNames).join(", ")}.`;

    studentIds.forEach((sid) => {
      const stu = store.users.find((u) => u.id === sid);
      pushNotif(store, sid, { type: "slots", title: "Novi termini objavljeni", message: msg });
      sendEmail(store, stu.email, `Novi termini od ${tutor.name}`, msg);
    });

    publish({ type: "slots:published", count: mineDraftThisWeek.length });
  };

  return (
    <section className="grid gap-4">
      <Card title="Moji termini (po danu)">
        <div className="flex flex-wrap items-end gap-2">
          <TimeField label="Sat" value={hh} setValue={setHh} min={0} max={23} />
          <button
            className="px-3 py-2 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: pastWeek ? "#e11d48" : "#4f46e5" }}
            onClick={add}
            disabled={pastWeek}
          >
            + Dodaj termin za {fmtDay(dayDate)}
          </button>
          <button
            className="px-3 py-2 rounded-lg text-white"
            style={{ background: pastWeek ? "#e11d48" : "#059669" }}
            onClick={publishWeek}
            disabled={pastWeek}
            title="Objavi sve draft termine u ovom tjednu"
          >
            ✅ Potvrdi i pošalji
          </button>
          <button className="px-3 py-2 rounded-lg bg-white border" onClick={postAnnouncement}>
            📢 Nova objava
          </button>
        </div>

        <div className="mt-4 grid gap-2 max-h-80 overflow-auto pr-1">
          {daySlots.length === 0 ? (
            <Empty>Nema termina za ovaj dan.</Empty>
          ) : (
            daySlots.map((s) => {
              const isReserved = !!s.reservedBy;
              const box = isReserved ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50";
              return (
                <div
                  key={s.id}
                  className={`p-3 rounded-xl border bg-white flex items-center justify-between gap-3 ${box}`}
                >
                  <div className="font-medium flex items-center gap-2">
                    <span>{fmtRangeFromISO(s.when)}</span>
                    {s.done && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        odrađeno
                      </span>
                    )}
                    {!s.published && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                        draft (nije objavljeno)
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-slate-600 flex items-center gap-3">
                    {s.reservedBy ? (
                      <>
                        Rezervirao: <b>{store.users.find((u) => u.id === s.reservedBy)?.name}</b>
                      </>
                    ) : (
                      <span className="text-slate-500">{s.published ? "slobodno" : "nevidljivo studentima"}</span>
                    )}
                    <button
                      className="px-2 py-1 rounded-lg bg-white border text-xs"
                      onClick={() => {
                        s.done = !s.done;
                        publish({ type: "slot:done", id: s.id, done: s.done });
                      }}
                    >
                      {s.done ? "Poništi odrađeno" : "Označi odrađeno"}
                    </button>
                    <button className="px-2 py-1 rounded-lg bg-white border text-xs" onClick={() => deleteSlot(s)}>
                      Obriši
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </section>
  );
}

/****************
 * ADMIN PANEL  *
 ****************/
function AdminPanel({ store, admin, weekStart, activeDay }) {
  const [selectedTutorId, setSelectedTutorId] = useState(
    store.users.find((u) => u.role === "tutor")?.id || ""
  );
  const [statsOpen, setStatsOpen] = useState(false);
  const [addModal, setAddModal] = useState({ open: false, role: "tutor" }); // {open, role:'tutor'|'student'}

  const tutors = store.users.filter((u) => u.role === "tutor");
  const teachables = store.users.filter((u) => u.role === "tutor" || u.role === "admin");
  const students = store.users.filter((u) => u.role === "student");
  const dayDate = dateForWeekday(weekStart, activeDay);

  const reassign = (studentId, newTutorId) => {
    store.assignments[studentId] = newTutorId;
    publish({ type: "assignment:update", studentId, newTutorId });
  };

  const addSlotAsAdmin = () => {
    const teacher = teachables.find((t) => t.id === selectedTutorId);
    if (!teacher) {
      window.alert("Odaberite tutora.");
      return;
    }
    const hh = parseInt(window.prompt("Sat (0-23):") || "10", 10);
    const dt = withTime(dayDate, hh, 0);
    const slot = { id: uid(), tutorId: teacher.id, when: dt.toISOString(), reservedBy: null, done: false, published: false };
    store.slots.push(slot);
    publish({ type: "slot:new", slot });
  };

  const deleteAnySlot = (s) => {
    store.slots = store.slots.filter((x) => x.id !== s.id);
    publish({ type: "slot:delete", id: s.id });
  };

  const deleteAnnouncement = (id) => {
    store.announcements = store.announcements.filter((a) => a.id !== id);
    publish({ type: "announcement:delete", id });
  };

  const allAnnouncements = store.announcements;

  // Samo termini odabranog tutora za AKTIVNI DAN
  const daySlotsForSelected = store.slots
    .filter((s) => s.tutorId === selectedTutorId)
    .filter((s) => sameDay(new Date(s.when), dayDate))
    .sort((a, b) => new Date(a.when) - new Date(b.when));

  return (
    <section className="grid gap-4">
      <Card title="Korisnici">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="p-3 rounded-xl border bg-white">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium">Tutori</div>
              <button className="px-2 py-1 rounded-lg bg-indigo-600 text-white text-xs" onClick={() => setAddModal({ open: true, role: "tutor" })}>
                ➕ Novi tutor
              </button>
            </div>
            <ul className="space-y-1 text-sm max-h-48 overflow-auto pr-1">
              {tutors.map((t) => (
                <li key={t.id} className="flex items-center justify-between">
                  <span>{t.name}</span>
                  <span className="text-xs text-slate-400">{t.username}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="p-3 rounded-xl border bg-white">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium">Studenti</div>
              <button className="px-2 py-1 rounded-lg bg-indigo-600 text-white text-xs" onClick={() => setAddModal({ open: true, role: "student" })}>
                ➕ Novi student
              </button>
            </div>
            <ul className="space-y-1 text-sm max-h-48 overflow-auto pr-1">
              {students.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{s.name}</span>
                  <select
                    className="px-2 py-1 rounded-lg border text-xs"
                    value={store.assignments[s.id] || ""}
                    onChange={(e) => reassign(s.id, e.target.value)}
                  >
                    {teachables
                      .filter((t) => t.role === "tutor" || t.role === "admin")
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      <Card title={`Termini za ${fmtDay(dayDate)} (odabrani tutor)`}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="text-sm text-slate-600">Tutor:</label>
          <select
            className="px-3 py-2 rounded-lg border"
            value={selectedTutorId}
            onChange={(e) => setSelectedTutorId(e.target.value)}
          >
            {teachables
              .filter((t) => t.role === "tutor")
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
          <button className="px-3 py-2 rounded-lg bg-white border" onClick={addSlotAsAdmin}>
            + Dodaj termin za {fmtDay(dayDate)}
          </button>
          <button className="px-3 py-2 rounded-lg bg-indigo-600 text-white" onClick={() => setStatsOpen(true)}>
            📊 Grafički prikaz
          </button>
        </div>

        {daySlotsForSelected.length === 0 ? (
          <Empty>Nema termina.</Empty>
        ) : (
          <ul className="grid gap-2 max-h-80 overflow-auto pr-1">
            {daySlotsForSelected.map((s) => {
              const isReserved = !!s.reservedBy;
              const box = isReserved ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50";
              const tutorName = store.users.find((u) => u.id === s.tutorId)?.name || "—";
              const studentName = s.reservedBy ? store.users.find((u) => u.id === s.reservedBy)?.name || "—" : "slobodno";
              return (
                <li key={s.id} className={`p-3 rounded-xl border bg-white flex items-center justify-between ${box}`}>
                  <div className="text-sm">
                    <div className="font-medium">{fmtRangeFromISO(s.when)}</div>
                    <div className="text-xs text-slate-500">Tutor: {tutorName}</div>
                    <div className="text-xs text-slate-500">Student: {studentName}</div>
                    {!s.published && <div className="text-xs text-amber-600">⚠️ Nije objavljeno studentima</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="px-2 py-1 rounded-lg bg-white border text-xs" onClick={() => deleteAnySlot(s)}>
                      Obriši
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title={`Statistika (tjedno) – ${fmtWeekRange(weekStart)}`}>
        {/* Tablični u layoutu, grafovi u popupu */}
        <AdminStatsTables store={store} initialWeekStart={weekStart} />
      </Card>

      <Card title="Sve objave (pregled i brisanje)">
        {allAnnouncements.length === 0 ? (
          <Empty>Nema objava.</Empty>
        ) : (
          <ul className="grid gap-2 max-h-64 overflow-auto pr-1">
            {allAnnouncements.map((a) => (
              <li key={a.id} className="p-3 rounded-xl border bg-white flex items-center justify-between">
                <div>
                  <div className="font-medium">
                    {a.title}{" "}
                    <span className="text-xs text-slate-400">• {store.users.find((u) => u.id === a.tutorId)?.name}</span>
                  </div>
                  <div className="text-xs text-slate-500">{new Date(a.createdAt).toLocaleString("hr-HR")}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="px-3 py-1.5 rounded-lg bg-white border"
                    onClick={() => window.alert("📢 " + a.title + "\n\n" + a.body)}
                  >
                    Otvori
                  </button>
                  <button
                    className="px-3 py-1.5 rounded-lg bg-rose-600 text-white"
                    onClick={() => deleteAnnouncement(a.id)}
                  >
                    Obriši
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {statsOpen && <StatsPopup store={store} initialWeekStart={weekStart} onClose={() => setStatsOpen(false)} />}
      {addModal.open && (
        <AddUserModal
          role={addModal.role}
          onClose={() => setAddModal({ open: false, role: "tutor" })}
          onSubmit={(payload) => {
            // payload: {name, username, email, password}
            const existsU = store.users.some(
              (u) => (u.username || "").toLowerCase() === payload.username.toLowerCase()
            );
            if (existsU) return alert("Korisničko ime je zauzeto.");
            const existsE = store.users.some(
              (u) => (u.email || "").toLowerCase() === payload.email.toLowerCase()
            );
            if (existsE) return alert("Email je zauzet.");

            const newU = { id: uid(), role: addModal.role, ...payload };
            store.users.push(newU);

            if (newU.role === "student") {
              const teachables = store.users.filter((u) => u.role === "tutor" || u.role === "admin");
              const tids = teachables.map((t) => t.id);
              const countPer = Object.fromEntries(tids.map((id) => [id, 0]));
              Object.entries(store.assignments).forEach(([sid, tid]) => {
                if (countPer[tid] != null) countPer[tid]++;
              });
              const target = tids.sort((a, b) => countPer[a] - countPer[b])[0] || teachables[0]?.id;
              if (target) store.assignments[newU.id] = target;
            }

            publish({ type: "user:new", newU });
            alert("Korisnik dodan.");
            setAddModal({ open: false, role: "tutor" });
          }}
        />
      )}
    </section>
  );
}

/*******************************
 * Popup: Grafička statistika  *
 *******************************/
function StatsPopup({ store, initialWeekStart, onClose }) {
  const [localWeekStart, setLocalWeekStart] = useState(startOfWeek(initialWeekStart));
  const goPrev = () => setLocalWeekStart((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7));
  const goNext = () =>
    setLocalWeekStart((d) => {
      const todayStart = startOfWeek(new Date());
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
      return next > todayStart ? todayStart : next;
    });

  const [perTutor, perStudent] = computeWeeklyStats(store, localWeekStart);
  const [aggTutors, aggStudents] = computeAllTimeStats(store);

  return (
    <Modal title="📊 Grafički prikaz statistike" onClose={onClose}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-slate-600">
          Tjedan: <b>{fmtWeekRange(localWeekStart)}</b>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 rounded-lg bg-white border" onClick={goPrev}>
            ⬅️ Prethodni
          </button>
          <button className="px-3 py-1.5 rounded-lg bg-white border" onClick={goNext}>
            ➡️ Sljedeći
          </button>
        </div>
      </div>

      <div className="grid gap-4">
        <Card title={`Tutori/Admin – odrađeni sati (tjedan ${fmtWeekRange(localWeekStart)})`}>
          {perTutor.length === 0 ? <Empty>Nema podataka.</Empty> : <BarChart data={perTutor.map((r) => ({ label: r.name, value: r.hours }))} height={400} valueSuffix=" h" />}
        </Card>

        <Card title={`Studenti – rezervirano vs odrađeno (tjedan ${fmtWeekRange(localWeekStart)})`}>
          {perStudent.length === 0 ? (
            <Empty>Nema podataka.</Empty>
          ) : (
            <GroupedBars
              data={perStudent.map((r) => ({
                label: r.name,
                series: [
                  { key: "Rezervirano", value: r.reserved },
                  { key: "Odradeno", value: r.done },
                ],
              }))}
              height={420}
            />
          )}
        </Card>

        <Card title="Sve skupa – tutori (kumulativno)">
          {aggTutors.length === 0 ? <Empty>Nema podataka.</Empty> : <BarChart data={aggTutors.map((r) => ({ label: r.name, value: r.hours }))} height={400} valueSuffix=" h" />}
        </Card>

        <Card title="Sve skupa – studenti (kumulativno)">
          {aggStudents.length === 0 ? <Empty>Nema podataka.</Empty> : <BarChart data={aggStudents.map((r) => ({ label: r.name, value: r.reserved }))} height={400} />}
        </Card>
      </div>
    </Modal>
  );
}

/**********************
 * Admin statistika – tablice (u layoutu)
 **********************/
const LESSON_MINUTES = 50;

function AdminStatsTables({ store, initialWeekStart }) {
  const [localWeekStart, setLocalWeekStart] = useState(startOfWeek(initialWeekStart));
  const goPrev = () => setLocalWeekStart((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7));
  const goNext = () =>
    setLocalWeekStart((d) => {
      const todayStart = startOfWeek(new Date());
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
      return next > todayStart ? todayStart : next;
    });

  const [perTutor, perStudent] = computeWeeklyStats(store, localWeekStart);
  const [aggTutors, aggStudents] = computeAllTimeStats(store);

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">
          Statistika za tjedan: <b>{fmtWeekRange(localWeekStart)}</b>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 rounded-lg bg-white border" onClick={goPrev}>
            ⬅️ Prethodni
          </button>
          <button className="px-3 py-1.5 rounded-lg bg-white border" onClick={goNext}>
            ➡️ Sljedeći
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <div className="text-sm font-medium mb-2">Tutori/Admin – odrađeni sati (tjedno)</div>
          {perTutor.length === 0 ? (
            <Empty>Nema podataka.</Empty>
          ) : (
            <div className="max-h-64 overflow-auto pr-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1">Ime</th>
                    <th className="py-1">Odr. sati</th>
                    <th className="py-1">Odr. termina</th>
                  </tr>
                </thead>
                <tbody>
                  {perTutor.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1">{r.name}</td>
                      <td className="py-1">{r.hours}</td>
                      <td className="py-1">{r.done}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div>
          <div className="text-sm font-medium mb-2">Studenti – rezervirano i odrađeno (tjedno)</div>
          {perStudent.length === 0 ? (
            <Empty>Nema podataka.</Empty>
          ) : (
            <div className="max-h-64 overflow-auto pr-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1">Ime</th>
                    <th className="py-1">Rezerv.</th>
                    <th className="py-1">Odrad.</th>
                    <th className="py-1">Sati (rez.)</th>
                    <th className="py-1">Sati (odrađ.)</th>
                  </tr>
                </thead>
                <tbody>
                  {perStudent.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1">{r.name}</td>
                      <td className="py-1">{r.reserved}</td>
                      <td className="py-1">{r.done}</td>
                      <td className="py-1">{r.resHours}</td>
                      <td className="py-1">{r.doneHours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <div className="text-sm font-semibold mb-2">Sve skupa (kumulativno – tutori)</div>
          {aggTutors.length === 0 ? (
            <Empty>Nema podataka.</Empty>
          ) : (
            <div className="max-h-64 overflow-auto pr-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1">Ime</th>
                    <th className="py-1">Odr. sati</th>
                    <th className="py-1">Odr. termina</th>
                  </tr>
                </thead>
                <tbody>
                  {aggTutors.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1">{r.name}</td>
                      <td className="py-1">{r.hours}</td>
                      <td className="py-1">{r.done}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div>
          <div className="text-sm font-semibold mb-2">Sve skupa (kumulativno – studenti)</div>
          {aggStudents.length === 0 ? (
            <Empty>Nema podataka.</Empty>
          ) : (
            <div className="max-h-64 overflow-auto pr-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1">Ime</th>
                    <th className="py-1">Rezerv.</th>
                    <th className="py-1">Odrad.</th>
                    <th className="py-1">Sati (rez.)</th>
                    <th className="py-1">Sati (odrađ.)</th>
                  </tr>
                </thead>
                <tbody>
                  {aggStudents.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1">{r.name}</td>
                      <td className="py-1">{r.reserved}</td>
                      <td className="py-1">{r.done}</td>
                      <td className="py-1">{r.resHours}</td>
                      <td className="py-1">{r.doneHours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function computeWeeklyStats(store, weekStart) {
  const start = startOfWeek(weekStart);
  const end = endOfWeek(weekStart);

  const teachers = store.users.filter((u) => u.role === "tutor" || u.role === "admin");
  const perTutor = teachers.map((t) => {
    const slots = store.slots.filter((s) => s.tutorId === t.id && new Date(s.when) >= start && new Date(s.when) < end);
    const done = slots.filter((s) => s.done).length;
    const hours = Number(((done * LESSON_MINUTES) / 60).toFixed(2));
    return { name: t.name, done, hours };
  });

  const students = store.users.filter((u) => u.role === "student");
  const perStudent = students.map((s) => {
    const slots = store.slots.filter((sl) => sl.reservedBy === s.id && new Date(sl.when) >= start && new Date(sl.when) < end);
    const reserved = slots.length;
    const done = slots.filter((sl) => sl.done).length;
    const resHours = Number(((reserved * LESSON_MINUTES) / 60).toFixed(2));
    const doneHours = Number(((done * LESSON_MINUTES) / 60).toFixed(2));
    return { name: s.name, reserved, done, resHours, doneHours };
  });

  return [perTutor, perStudent];
}

function computeAllTimeStats(store) {
  const teachers = store.users.filter((u) => u.role === "tutor" || u.role === "admin");
  const aggTutors = teachers.map((t) => {
    const slots = store.slots.filter((s) => s.tutorId === t.id);
    const done = slots.filter((s) => s.done).length;
    const hours = Number(((done * LESSON_MINUTES) / 60).toFixed(2));
    return { name: t.name, done, hours };
  });

  const students = store.users.filter((u) => u.role === "student");
  const aggStudents = students.map((s) => {
    const slots = store.slots.filter((sl) => sl.reservedBy === s.id);
    const reserved = slots.length;
    const done = slots.filter((sl) => sl.done).length;
    const resHours = Number(((reserved * LESSON_MINUTES) / 60).toFixed(2));
    const doneHours = Number(((done * LESSON_MINUTES) / 60).toFixed(2));
    return { name: s.name, reserved, done, resHours, doneHours };
  });

  return [aggTutors, aggStudents];
}

/**********************
 * Grafovi (povećani) *
 **********************/
function BarChart({ data, height = 400, valueSuffix = "" }) {
  const padding = { top: 20, right: 40, bottom: 60, left: 50 };
  const width = Math.max(800, data.length * 80);
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;
  const max = Math.max(1, ...data.map((d) => d.value));
  const barW = w / data.length;

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="border rounded-xl bg-white">
        <g transform={`translate(${padding.left},${padding.top})`}>
          {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
            const y = h - t * h;
            const v = (t * max).toFixed(0);
            return (
              <g key={i}>
                <line x1={0} y1={y} x2={w} y2={y} stroke="#e5e7eb" />
                <text x={-10} y={y} textAnchor="end" dominantBaseline="middle" fontSize="12" fill="#6b7280">
                  {v}
                </text>
              </g>
            );
          })}
          {data.map((d, i) => {
            const bh = (d.value / max) * h;
            return (
              <g key={i} transform={`translate(${i * barW},0)`}>
                <rect
                  x={barW * 0.15}
                  y={h - bh}
                  width={barW * 0.7}
                  height={bh}
                  fill="#6366f1"
                  rx="8"
                  opacity="0.9"
                />
                <text
                  x={barW * 0.5}
                  y={h - bh - 10}
                  textAnchor="middle"
                  fontSize="13"
                  fill="#111827"
                  fontWeight="600"
                >
                  {d.value}{valueSuffix}
                </text>
                <text
                  x={barW * 0.5}
                  y={h + 24}
                  textAnchor="middle"
                  fontSize="12"
                  fill="#374151"
                >
                  {d.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function GroupedBars({ data, height = 420 }) {
  const padding = { top: 20, right: 40, bottom: 60, left: 50 };
  const width = Math.max(900, data.length * 100);
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;
  const max = Math.max(1, ...data.flatMap((d) => d.series.map((s) => s.value)));
  const groups = data.length;
  const seriesCount = data[0]?.series.length || 0;
  const groupW = w / groups;
  const colors = ["#10b981", "#ef4444", "#3b82f6", "#f59e0b"];

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="border rounded-xl bg-white">
        <g transform={`translate(${padding.left},${padding.top})`}>
          {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
            const y = h - t * h;
            const v = (t * max).toFixed(0);
            return (
              <g key={i}>
                <line x1={0} y1={y} x2={w} y2={y} stroke="#e5e7eb" />
                <text x={-10} y={y} textAnchor="end" dominantBaseline="middle" fontSize="12" fill="#6b7280">
                  {v}
                </text>
              </g>
            );
          })}
          {data.map((g, gi) => {
            const barW = (groupW * 0.7) / Math.max(1, seriesCount);
            return (
              <g key={gi} transform={`translate(${gi * groupW},0)`}>
                {g.series.map((s, si) => {
                  const bh = (s.value / max) * h;
                  const x = groupW * 0.15 + si * barW;
                  return (
                    <g key={si}>
                      <rect x={x} y={h - bh} width={barW - 3} height={bh} fill={colors[si % colors.length]} rx="6" />
                      <text
                        x={x + (barW - 3) / 2}
                        y={h - bh - 10}
                        textAnchor="middle"
                        fontSize="13"
                        fontWeight="600"
                        fill="#111827"
                      >
                        {s.value}
                      </text>
                    </g>
                  );
                })}
                <text x={groupW * 0.5} y={h + 24} textAnchor="middle" fontSize="12" fill="#374151">
                  {g.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

/**********************
 * Modal (popup)       *
 **********************/
function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-5xl max-h-[85vh] overflow-auto rounded-2xl bg-white border p-4 grid gap-3 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">{title}</div>
          <button className="px-3 py-1.5 rounded-lg bg-slate-900 text-white" onClick={onClose}>
            Zatvori
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**********************
 * Login modal         *
 **********************/
function LoginModal({ store, onClose, onSuccess }) {
  const [identifier, setIdentifier] = useState(""); // email ili username
  const [password, setPassword] = useState("");

  const submit = (e) => {
    e.preventDefault();
    const idLower = identifier.trim().toLowerCase();
    const user = store.users.find(
      (u) => (u.email || "").toLowerCase() === idLower || (u.username || "").toLowerCase() === idLower
    );
    if (!user) return alert("Korisnik nije pronađen.");
    if ((user.password || "") !== password) return alert("Pogrešna lozinka.");
    onSuccess?.(user);
    onClose?.();
  };

  return (
    <Modal title="🔐 Prijava" onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3">
        <label className="grid gap-1 text-sm">
          <span className="text-slate-600">Email ili korisničko ime</span>
          <input
            className="px-3 py-2 rounded-lg border"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="npr. admin ili admin@uni.hr"
            required
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-slate-600">Lozinka</span>
          <input
            type="password"
            className="px-3 py-2 rounded-lg border"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="•••••••"
            required
          />
        </label>
        <div className="flex items-center gap-2">
          <button type="submit" className="px-3 py-2 rounded-lg bg-indigo-600 text-white">
            Prijavi se
          </button>
          <button type="button" className="px-3 py-2 rounded-lg bg-white border" onClick={onClose}>
            Odustani
          </button>
        </div>
        <div className="text-xs text-slate-500">
          Demo korisnici: admin/admin123, ivana/test123, marko/test123, ana/test123, petar/test123
        </div>
      </form>
    </Modal>
  );
}

/**********************
 * Add user modal      *
 **********************/
function AddUserModal({ role, onClose, onSubmit }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (name && !username) setUsername(slug(name).replace(/\./g, ""));
    if (name && !email) setEmail(`${slug(name)}@uni.hr`);
    // eslint-disable-next-line
  }, [name]);

  const submit = (e) => {
    e.preventDefault();
    if (!name || !username || !email || !password) return alert("Ispunite sva polja.");
    onSubmit?.({ name, username, email, password });
  };

  return (
    <Modal title={`➕ Novi ${role === "tutor" ? "tutor" : "student"}`} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3 max-w-lg">
        <label className="grid gap-1 text-sm">
          <span className="text-slate-600">Ime i prezime</span>
          <input className="px-3 py-2 rounded-lg border" value={name} onChange={(e) => setName(e.target.value)} placeholder="npr. Luka Primjer" required />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-slate-600">Korisničko ime</span>
          <input className="px-3 py-2 rounded-lg border" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="npr. luka" required />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-slate-600">Email</span>
          <input type="email" className="px-3 py-2 rounded-lg border" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="npr. luka@uni.hr" required />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-slate-600">Lozinka</span>
          <input type="password" className="px-3 py-2 rounded-lg border" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="•••••••" required />
        </label>
        <div className="flex items-center gap-2">
          <button type="submit" className="px-3 py-2 rounded-lg bg-indigo-600 text-white">Spremi</button>
          <button type="button" className="px-3 py-2 rounded-lg bg-white border" onClick={onClose}>Odustani</button>
        </div>
        <div className="text-xs text-slate-500">
          Napomena: podaci se spremaju lokalno (localStorage) — demo bez backenda.
        </div>
      </form>
    </Modal>
  );
}

/**********************
 * Notifikacije panel  *
 **********************/
function NotificationsPanel({ store, user }) {
  const list = store.notifications[user.id] || [];
  const markRead = (id) => {
    const n = list.find((x) => x.id === id);
    if (n) n.read = true;
    publish({ type: "notification:update" });
  };
  const clearAll = () => {
    store.notifications[user.id] = [];
    publish({ type: "notification:clear" });
  };
  const removeOne = (id) => {
    store.notifications[user.id] = list.filter((n) => n.id !== id);
    publish({ type: "notification:remove" });
  };
  return (
    <Card title="Obavijesti (u aplikaciji)">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-slate-500">Ukupno: {list.length}</div>
        {list.length > 0 && (
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 rounded-lg bg-white border text-xs" onClick={clearAll}>
              Očisti sve
            </button>
          </div>
        )}
      </div>
      {list.length === 0 ? (
        <Empty>Nema obavijesti.</Empty>
      ) : (
        <ul className="grid gap-2 max-h-64 overflow-auto pr-1">
          {list.map((n) => (
            <li
              key={n.id}
              className={
                "p-3 rounded-xl border bg-white flex items-start justify-between gap-3 " +
                (n.read ? "opacity-70" : "")
              }
            >
              <div>
                <div className="text-sm font-medium">{n.title}</div>
                <div className="text-xs text-slate-500">{new Date(n.createdAt).toLocaleString("hr-HR")}</div>
                <div className="text-sm mt-1">{n.message}</div>
              </div>
              <div className="flex items-center gap-2">
                {!n.read && (
                  <button className="px-2 py-1 rounded-lg bg-white border text-xs" onClick={() => markRead(n.id)}>
                    Označi kao pročitano
                  </button>
                )}
                <button className="px-2 py-1 rounded-lg bg-white border text-xs" onClick={() => removeOne(n.id)}>
                  🗑️
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/************************
 * Objave (mini pregled) *
 ************************/
function AnnouncementsPanel({ store, user }) {
  let items = [];
  if (user.role === "admin") items = store.announcements;
  if (user.role === "tutor") items = store.announcements.filter((a) => a.tutorId === user.id);
  if (user.role === "student") {
    const tid = store.assignments[user.id];
    items = store.announcements.filter((a) => a.tutorId === tid);
    const hiddenArr = store.hiddenAnnouncements[user.id] || [];
    const hidden = new Set(hiddenArr);
    items = items.filter((a) => !hidden.has(a.id));
  }

  const removeForMe = (a) => {
    if (!store.hiddenAnnouncements[user.id]) store.hiddenAnnouncements[user.id] = [];
    const arr = store.hiddenAnnouncements[user.id];
    if (!arr.includes(a.id)) arr.push(a.id);
    publish({ type: "announcement:hidden", id: a.id, userId: user.id });
  };

  const deleteGlobal = (a) => {
    if (user.role === "tutor" && a.tutorId !== user.id) return;
    store.announcements = store.announcements.filter((x) => x.id !== a.id);
    publish({ type: "announcement:delete", id: a.id });
  };

  return (
    <Card title="Objave">
      {items.length === 0 ? (
        <Empty>Nema objava.</Empty>
      ) : (
        <ul className="grid gap-2 max-h-64 overflow-auto pr-1">
          {items.slice(0, 20).map((a) => (
            <li key={a.id} className="p-3 rounded-xl border bg-white flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <div className="font-medium truncate">{a.title}</div>
                  <span className="text-xs text-slate-500">{new Date(a.createdAt).toLocaleString("hr-HR")}</span>
                </div>
                <div className="text-xs text-slate-500 mt-1">{store.users.find((u) => u.id === a.tutorId)?.name}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-1.5 rounded-lg bg-white border"
                  onClick={() => window.alert("📢 " + a.title + "\n\n" + a.body)}
                >
                  Otvori
                </button>
                {user.role === "student" && (
                  <button className="px-3 py-1.5 rounded-lg bg-white border" onClick={() => removeForMe(a)}>
                    Ukloni
                  </button>
                )}
                {(user.role === "admin" || (user.role === "tutor" && a.tutorId === user.id)) && (
                  <button className="px-3 py-1.5 rounded-lg bg-rose-600 text-white" onClick={() => deleteGlobal(a)}>
                    Obriši
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**********************
 * Email log (demo)    *
 **********************/
function EmailLog({ store, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-end md:items-center justify-center p-4 z-50">
      <div className="w-full max-w-3xl max-h-[80vh] overflow-auto rounded-2xl bg-white border p-4 grid gap-3">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">📧 Email log (demo)</div>
          <button className="px-3 py-1.5 rounded-lg bg-slate-900 text-white" onClick={onClose}>
            Zatvori
          </button>
        </div>
        {store.emailLog.length === 0 ? (
          <Empty>Nema poslanih emailova.</Empty>
        ) : (
          <ul className="grid gap-2">
            {store.emailLog.map((m) => (
              <li key={m.id} className="p-3 rounded-xl border bg-white">
                <div className="text-sm">
                  <b>To:</b> {m.to}
                </div>
                <div className="text-sm">
                  <b>Subject:</b> {m.subject}
                </div>
                <div className="text-xs text-slate-500">{new Date(m.at).toLocaleString("hr-HR")}</div>
                <pre className="mt-2 text-sm whitespace-pre-wrap">{m.body}</pre>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/*******************
 * UI pomoćnici     *
 *******************/
function Card({ title, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      {title && <h3 className="text-base font-semibold mb-3">{title}</h3>}
      {children}
    </section>
  );
}
function Empty({ children }) {
  return <div className="text-sm text-slate-500 italic">{children}</div>;
}
function TimeField({ label, value, setValue, min, max, step = 1 }) {
  return (
    <label className="text-sm grid gap-1">
      <span className="text-slate-600">{label}</span>
      <input
        type="number"
        className="px-3 py-2 rounded-lg border w-24"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setValue(Math.max(min, Math.min(max, parseInt(e.target.value || 0, 10))))}
      />
    </label>
  );
}

/*******************
 * Domenske funkcije *
 *******************/
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function markAnnouncementRead(store, userId, announcementId) {
  const a = store.announcements.find((x) => x.id === announcementId);
  if (!a) return;
  a.readBy = Array.from(new Set([...(a.readBy || []), userId]));
  publish({ type: "announcement:read", userId, announcementId });
}
function isAnnouncementRead(a, userId) {
  return (a.readBy || []).includes(userId);
}
// Tjedni reset (interno; UI nema gumb)
function maybeWeeklyReset(store, force = false) {
  const now = new Date();
  const isSunday = now.getDay() === 0;
  const last = store.lastWeeklyResetAt ? new Date(store.lastWeeklyResetAt) : null;
  const should = force || (isSunday && (!last || last.toDateString() !== now.toDateString()));
  if (!should) return;
  store.slots = [];
  store.lastWeeklyResetAt = now.toISOString();
  pushAll(store, { type: "system", title: "Tjedni reset", message: "Stari termini i rezervacije su obrisani." });
  publish({ type: "reset:weekly" });
}
function pushAll(store, payload) {
  store.users.forEach((u) => pushNotif(store, u.id, payload));
}
