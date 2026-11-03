// Registry names: quotes, apostrophes and letter case.

export const ABBREVIATIONS = new Set(['ОУН', 'ЗСУ', 'ВПО', 'АТО', 'ООС', 'ТЦК', 'ДСНС', 'НГУ', 'СБУ', 'УБД', 'ВІЛ', 'СНІД',
    'ЮНІСЕФ', 'ООН', 'ЄС', 'США', 'ГО', 'БФ', 'МБФ', 'ВГО', 'ВБФ', 'ЛГБТ', 'IT', 'НАТО', 'ОСББ', 'ТРО', 'ДФТГ', 'ЮА', 'UA']);

// Place names keep their capital letter after lower-casing (stems match any case ending).
const PROPER_STEMS = /^(КИ[ЄЇ]В|ХАРК|ОДЕС|ДНІПР|ЛЬВ[ОІ]В|ЗАПОРІ|МИКОЛА[ЄЇ]|ВІННИ|ХЕРСОН|ПОЛТАВ|ЧЕРНІГ|ЧЕРКАС|ЖИТОМИР|СУМ[ИА]?$|РІВН|ТЕРНОП|ЛУЦЬК|УЖГОРОД|ЧЕРНІВ|КРАМАТОР|МАРІУПОЛ|КРИВ|БУЧ|ІРП|УКРАЇН|ДОНБАС|КРИМ|ВОЛИН|ПОДІЛ|БУКОВИН|ГАЛИЧ|ЗАКАРПАТ|СЛОБОЖАН|ПРИКАРПАТ|ІВАНО-ФРАНК|КРОПИВН|ХМЕЛЬН|БІЛ[ОИ]ЦЕРК|КРЕМЕНЧ|ІЗМАЇЛ|БЕРДЯН|МЕЛІТОП|СЄВЄРОДОН|ЛИСИЧАН|БАХМУТ|ХОРТИЦ)/;

const LETTER = /[А-ЯІЇЄҐA-Zа-яіїєґa-z0-9]/;

/** Turns registry quotes into «» (nested quotes included) and quote-apostrophes into ’. */
export function placeQuotes(name) {
    const chars = [...String(name).replace(/[«»“”„]/g, '"')];
    let prevKind = null;
    return chars.map((ch, i) => {
        if (ch !== '"') {
            prevKind = null;
            return ch;
        }
        const before = chars[i - 1] || ' ';
        const after = chars[i + 1] || ' ';
        // The registry writes apostrophes as double quotes: ОБ"ЄДНАННЯ (labial/р before є, ї, ю, я).
        if (/[бпвмфрБПВМФР]/.test(before) && /[єїюяЄЇЮЯ]/.test(after)) {
            prevKind = null;
            return '’';
        }
        let open;
        if (before === '"') open = prevKind === 'open';
        else open = /[\s(]/.test(before) || i === 0;
        prevKind = open ? 'open' : 'close';
        return open ? '«' : '»';
    }).join('');
}

/** "БЛАГОДІЙНИЙ ФОНД "СКАУТИ МИКОЛАЄВА"" → "Благодійний фонд «Скаути Миколаєва»" */
export function prettifyName(name) {
    if (!name) return name;
    let s = placeQuotes(name);
    // Only fully upper-case words are lower-cased; mixed-case words were typed that way on purpose.
    s = s.replace(/[А-ЯІЇЄҐA-Z][А-ЯІЇЄҐA-Z’'-]+/g, word => {
        if (ABBREVIATIONS.has(word)) return word;
        const lower = word.toLowerCase();
        return PROPER_STEMS.test(word) ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    });
    // "М. КИЄВА" → "м. Києва", "С. ..." → "с. ..." (town/village abbreviations).
    s = s.replace(/(^|[\s«(])(М|С|СМТ|смт)\.\s?([а-яіїєґА-ЯІЇЄҐ’'-]+)/g, (m, pre, abbr, w) => `${pre}${abbr.toLowerCase()}. ${w.charAt(0).toUpperCase()}${w.slice(1)}`);
    // Capitalize the very first letter and the first letter inside quotes.
    return s.replace(/^\s*[а-яіїєґa-z]/, c => c.toUpperCase()).replace(/«\s*([а-яіїєґa-z])/g, (m, c) => `«${c.toUpperCase()}`);
}

/** Distinctive part of a name: the innermost quoted segment, e.g. «Скаути Миколаєва». */
export function coreName(name) {
    const s = placeQuotes(name || '');
    const segments = [...s.matchAll(/«([^«»]+)»/g)].map(m => m[1].trim()).filter(Boolean);
    return segments.length ? segments[segments.length - 1] : String(name || '').trim();
}
