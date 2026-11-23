/**
 * The interest filter. No model involved: a deny list, a substance floor,
 * and a score used only to order the deck.
 */

// Matched against the title only, to keep false positives low.
// Matched against the title only. Entries are matched on word boundaries, so a
// short word can never fire from inside a longer one ("גשם" must not match
// "יערות הגשם", "פצועים" must not match a study about wound chemistry).
const DENY_TITLE: string[] = [
  // sport
  "כדורגל","כדורסל","הפועל","מכבי","ליגה","ליגת","אליפות","מונדיאל","אולימפיאדה",
  "נבחרת","אימון הכושר",
  // celebrity / reality
  "ריאליטי","האח הגדול","הישרדות","רכילות","דוגמנית","זמרת","הזמר","סלב",
  "המאהב","התארסו","נפרדו","חתונה של",
  // crime / war — only unambiguous phrases
  "נעצר","נעצרו","רצח","נרצח","כתב אישום","שוד","פיגוע","נדקר","הרוגים",
  "מחבל","חשד לרצח","חשד לשוד","צה\"ל תקף","חיסל",
  // politics
  "כנסת","קואליציה","אופוזיציה","בחירות","נתניהו","מפלגת","ועדת הכספים",
  "בג\"ץ","יועמ\"ש","הממשלה אישרה",
  // traffic / weather / service journalism
  "תאונה","תאונות","פקקים","נחסם לתנועה","תחזית מזג האוויר","גל חום","סופת",
  "הורוסקופ","מזלות",
  // shopping
  "בלאק פריידי","black friday","סייל","מבצעי","קופון","כמה זה עולה",
  "שווה לקנות","זה הזמן לקנות",
  // promotional / sponsored / events
  "בואו ללמוד","בואו לשמוע","בלייב","וובינר","webinar","הרשמה ל","מיטאפ",
  "meetup","תוכן שיווקי","ממומן","פוסט אורח","דרושים","משרות","בחסות",
  "הזדמנות אחרונה","לצפייה בהרצאה",
  // listicle / engagement bait
  "10 הדברים","5 הדברים","7 הדברים","כל מה שצריך לדעת","לא תאמינו",
  "האמת על","מה באמת קורה",
];

const DENY_EN_TITLE: string[] = [
  "nfl","nba","super bowl","premier league","kardashian","celebrity","royal family",
  "black friday","coupon","best deals","shop now","sponsored","webinar",
];

// Signals that an item is the kind of thing this app exists for.
const BOOST_WORDS: string[] = [
  "מחקר","מחקר חדש","חוקרים","גילו","תגלית","ניסוי","מדענים","אוניברסיטת","מכון",
  "למה","כיצד","איך","מסתבר","הסבר","תיאוריה","ממצאים","כוכב","גלקסיה","חלל",
  "אבולוציה","מוח","נוירו","גנטי","חיסון","אקלים","ארכיאולוג","היסטוריה","מתמטיק",
  "אלגוריתם","בינה מלאכותית","קוונטי","פיזיקה","כימיה","ביולוגיה","רובוט","סטארטאפ",
  "הנדסה","פטנט","תרופה","מיקרוביום","פילוסופיה","כלכלה התנהגותית",
  "study","research","scientists","discovered","why","how","physics","quantum",
  "algorithm","neuroscience","evolution","archaeolog","mathemat",
];

export interface Candidate {
  id: string;
  title: string;
  text: string;
  url: string;
  sourceId: string;
  source: string;
  tag: string;
  lang: string;
  date: string;
  weight: number;
  kind: "flow" | "stock";
  /** Reference-work entries ("ארס", "כפר סבא") have legitimately short titles. */
  titleIsName?: boolean;
  score?: number;
}

const BOUNDARY = "[^\\p{L}\\p{N}]";
/** Hebrew attaches prefixes straight onto the word: "לבלאק פריידי", "בכנסת". */
const PREFIX = "[\\u05d1\\u05d4\\u05d5\\u05db\\u05dc\\u05de\\u05e9]?";

/**
 * Word-boundary containment. JavaScript's \b is ASCII-only, so Hebrew needs an
 * explicit non-letter boundary. Without this, "גשם" fires inside "יערות הגשם"
 * and quietly drops the articles this app exists for.
 */
function hits(haystack: string, needles: string[]): boolean {
  const h = ` ${haystack.toLowerCase()} `;
  return needles.some((n) => {
    const esc = n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|${BOUNDARY})${PREFIX}${esc}(?:${BOUNDARY}|$)`, "u").test(h);
  });
}

export function isDenied(c: Candidate): string | null {
  if (hits(c.title, DENY_TITLE)) return "deny:he";
  if (hits(c.title, DENY_EN_TITLE)) return "deny:en";
  return null;
}

export function reject(c: Candidate, minChars: number, maxAgeDays: number | null): string | null {
  const minTitle = c.titleIsName ? 3 : 18;
  if (!c.title || c.title.length < minTitle) return "title-too-short";
  if (!c.url) return "no-url";
  if (c.text.length < minChars) return "thin-excerpt";
  // A "title plus nothing" item: excerpt is just the headline again.
  if (c.text.slice(0, 40) === c.title.slice(0, 40) && c.text.length < c.title.length * 1.6) {
    return "excerpt-echoes-title";
  }
  if (/^(bene|test|טסט|בדיקה)$/i.test(c.title.trim())) return "test-post";
  const denied = isDenied(c);
  if (denied) return denied;
  if (maxAgeDays !== null) {
    const age = (Date.now() - new Date(c.date).getTime()) / 86400000;
    if (!Number.isFinite(age) || age > maxAgeDays) return "too-old";
  }
  return null;
}

/** Reference-work biographies read poorly as standalone cards. */
function looksLikeBiography(c: Candidate): boolean {
  if (!c.titleIsName) return false;
  return /\(נולד\s|\(נולדה\s|\d{4}\s*[\u2013-]\s*\d{4}\)|היה\s\S+\s(ישראלי|אמריקאי|יהודי)|הוא\s\S+\s(ישראלי|אמריקאי)/.test(c.text);
}

export function score(c: Candidate): number {
  let s = c.weight * 10;
  const blob = `${c.title} ${c.text}`;
  if (looksLikeBiography(c)) s -= 28;
  // Substance: longer excerpts usually mean a real article.
  s += Math.min(c.text.length / 40, 8);
  // Topic fit.
  const boosts = BOOST_WORDS.filter((w) => blob.toLowerCase().includes(w.toLowerCase())).length;
  s += Math.min(boosts * 3, 15);
  // Questions in a headline tend to be explainers, which read well as cards.
  if (/[?]\s*$/.test(c.title) || /^(למה|איך|כיצד|מה )/.test(c.title)) s += 4;
  // Mild recency preference inside the flow bucket only.
  if (c.kind === "flow") {
    const age = (Date.now() - new Date(c.date).getTime()) / 86400000;
    if (Number.isFinite(age)) s += Math.max(0, 6 - age);
  }
  // Hebrew is the point of the app.
  if (c.lang === "he") s += 6;
  return Math.round(s * 100) / 100;
}
