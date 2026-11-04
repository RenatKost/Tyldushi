// Fine-grained catalog of concrete services. Organizations get services only with evidence
// (a quote and a source link), and free-text requests are mapped to the same keys, so search
// compares like with like instead of guessing from broad categories.

export const AUDIENCES = {
    veterans: { label: 'Ветерани', stems: ['ветеран', 'убд', 'демобіліз', 'після фронту', 'з фронту', 'повернувся з', 'учасник бойових'] },
    military: { label: 'Військові', stems: ['військов', 'зсу', 'бійц', 'боєць', 'солдат', 'бригад', 'на фронт', 'захисник'] },
    families: { label: 'Родини військових', stems: ['дружин', 'родин', 'мам', 'тат', 'сім’', "сім'", 'сімей', 'мати', 'матер', 'син', 'доньк', 'батьк', 'чоловік', 'загибл'] },
    children: { label: 'Діти', stems: ['дит', 'діт', 'підліт', 'школяр', 'малюк', 'сирот'] },
    idp: { label: 'Переселенці', stems: ['впо', 'переселен', 'евакуйов', 'переміщен', 'біженц'] },
    elderly: { label: 'Літні люди', stems: ['літн', 'пенсіонер', 'похилого', 'бабус', 'дідус'] },
    disability: { label: 'Люди з інвалідністю', stems: ['інвалід', 'особлив', 'на візку', 'незряч', 'глух'] },
};

export const SERVICES = [
    // Psychological help
    { key: 'psych_individual', label: 'Індивідуальна консультація психолога', category: 'psychological', stems: ['психолог', 'психотерап', 'консультація психолога', 'поговорити з фахівцем'] },
    { key: 'psych_groups', label: 'Групи підтримки', category: 'psychological', stems: ['групи підтримки', 'група підтримки', 'групов', 'зустрічі ветеранів', 'коло підтримки'] },
    { key: 'psych_children', label: 'Психологічна допомога дітям', category: 'psychological', stems: ['дитячий психолог', 'психолог для дит', 'арт-терап', 'арттерап', 'казкотерап', 'ігрова терап'] },
    { key: 'ptsd', label: 'Робота з ПТСР і травмою', category: 'psychological', stems: ['птср', 'посттравм', 'травм', 'бойовий стрес', 'кошмар', 'панічн', 'тривожн'] },
    { key: 'psych_hotline', label: 'Гаряча лінія та онлайн-підтримка', category: 'psychological', stems: ['гаряча лінія', 'онлайн-психолог', 'онлайн психолог', 'чат підтримки', 'цілодобов'] },
    // Rehabilitation and medicine
    { key: 'prosthetics', label: 'Протезування', category: 'rehabilitation', stems: ['протез', 'ампутац'] },
    { key: 'physical_rehab', label: 'Фізична реабілітація', category: 'rehabilitation', stems: ['реабіліт', 'фізіотерап', 'лфк', 'ерготерап', 'масаж', 'відновлення після поранен', 'поранен', 'контузі'] },
    { key: 'rehab_equipment', label: 'Засоби реабілітації (візки, милиці)', category: 'rehabilitation', stems: ['візок', 'візки', 'милиц', 'ходунк', 'засоби реабіліт', 'ортез'] },
    { key: 'medicines', label: 'Ліки та медикаменти', category: 'medical', stems: ['лік', 'медикамент', 'аптек', 'препарат', 'лекарств', 'інсулін'] },
    { key: 'medical_referral', label: 'Медичний супровід і перенаправлення', category: 'medical', stems: ['лікар', 'обстежен', 'діагност', 'госпіталіз', 'медичний супровід', 'перенаправлен до лікар', 'операці', 'лікуван'] },
    { key: 'dental', label: 'Стоматологічна допомога', category: 'medical', stems: ['стоматолог', 'зуб'] },
    { key: 'hospital_equipment', label: 'Обладнання для лікарень', category: 'medical', stems: ['обладнання для лікарн', 'медичне обладнання', 'апарат шві', 'для госпітал'] },
    // Legal help and documents
    { key: 'legal_consult', label: 'Юридична консультація', category: 'legal', stems: ['юрист', 'юридичн', 'адвокат', 'правов', 'суд', 'позов', 'спадщин'] },
    { key: 'ubd_status', label: 'Оформлення статусу УБД та пільг', category: 'legal', stems: ['убд', 'статус учасника', 'пільг', 'посвідчен', 'статус ветерана', 'інвалідність внаслідок війни', 'мсек', 'вкк'] },
    { key: 'social_payments', label: 'Соціальні виплати, пенсії, компенсації', category: 'legal', stems: ['виплат', 'пенсі', 'компенсац', 'грошова допомога від держави', 'субсиді'] },
    { key: 'documents_help', label: 'Допомога з документами', category: 'legal', stems: ['документ', 'довідк', 'оформит', 'оформлен', 'паспорт', 'реєстрац'] },
    { key: 'missing_pow', label: 'Пошук зниклих безвісти та полонених', category: 'legal', stems: ['зниклий', 'зниклих', 'безвісти', 'полон', 'обмін полонен'] },
    { key: 'tck_questions', label: 'Питання ТЦК, відстрочки, мобілізації', category: 'legal', stems: ['тцк', 'відстрочк', 'мобілізац', 'повістк', 'військкомат'] },
    // Work and business
    { key: 'grants', label: 'Гранти та розвиток власної справи', category: 'education', stems: ['грант', 'власна справа', 'власну справу', 'бізнес', 'фоп', 'стартап', 'підприємництв'] },
    { key: 'employment', label: 'Працевлаштування', category: 'education', stems: ['працевлашт', 'робот', 'вакансі', 'роботодав'] },
    { key: 'retraining', label: 'Навчання та перекваліфікація', category: 'education', stems: ['перекваліф', 'курс', 'навчан', 'професі', 'освіт для дорослих', 'тренінг'] },
    // Humanitarian aid
    { key: 'food', label: 'Продуктові набори та харчування', category: 'humanitarian', stems: ['продукт', 'продуктов', 'харч', 'їж', 'обід', 'круп', 'гаряче', 'поїс', 'нагоду', 'голод', 'еда', 'поесть'] },
    { key: 'clothes', label: 'Одяг і речі першої необхідності', category: 'humanitarian', stems: ['одяг', 'речі', 'взутт', 'ковдр', 'постіль'] },
    { key: 'hygiene', label: 'Засоби гігієни', category: 'humanitarian', stems: ['гігієн', 'підгузк', 'памперс', 'засоби догляду'] },
    { key: 'heating', label: 'Генератори, обігрів, утеплення', category: 'humanitarian', stems: ['генератор', 'дров', 'утеплен', 'обігрів', 'павербанк', 'світло'] },
    // Housing and displaced people
    { key: 'idp_housing', label: 'Житло для переселенців', category: 'housing', stems: ['житл', 'прихист', 'гуртожит', 'оренд', 'де жити', 'поселен'] },
    { key: 'home_repair', label: 'Ремонт і відбудова житла', category: 'housing', stems: ['ремонт', 'відбуд', 'вікна', 'дах', 'зруйнован'] },
    { key: 'shelter', label: 'Кризове житло / шелтер', category: 'housing', stems: ['шелтер', 'кризов', 'притул для людей', 'насильств'] },
    { key: 'idp_support', label: 'Допомога переселенцям з адаптацією', category: 'idp', stems: ['впо', 'переселен', 'адаптац', 'інтеграц', 'переїзд'] },
    { key: 'evacuation', label: 'Евакуація', category: 'idp', stems: ['евакуац', 'вивезти', 'виїхати з'] },
    // Children and families
    { key: 'children_leisure', label: 'Дозвілля, гуртки, табори для дітей', category: 'children', stems: ['табір', 'табор', 'гурт', 'дозвілл', 'майстер-клас', 'свято для дітей'] },
    { key: 'children_education', label: 'Освіта та розвиток дітей', category: 'children', stems: ['школ', 'репетитор', 'навчання дітей', 'розвиток дітей', 'садок', 'стипенді'] },
    { key: 'family_support', label: 'Підтримка родин військових та загиблих', category: 'veterans', stems: ['родин загибл', 'сім’ї загибл', "сім'ї загибл", 'родин військов', 'сімей військов', 'дружин військов', 'вдов'] },
    // Military and veterans
    { key: 'military_supply', label: 'Забезпечення військових (амуніція, дрони, авто)', category: 'military', stems: ['дрон', 'амуніц', 'бронежилет', 'тактичн', 'автомобіл для фронту', 'авто для зсу', 'спорядж', 'для фронту'] },
    { key: 'tactical_medicine', label: 'Тактична медицина (аптечки, турнікети)', category: 'military', stems: ['турнікет', 'аптечк', 'тактична медицин', 'такмед'] },
    { key: 'veteran_space', label: 'Ветеранський простір, клуб, хаб', category: 'veterans', stems: ['ветеранський простір', 'ветеранський хаб', 'ветеранський клуб', 'простір для ветеранів', 'хаб'] },
    { key: 'adaptive_sport', label: 'Спорт і адаптивний спорт', category: 'veterans', stems: ['спорт', 'адаптивн', 'тренуван', 'змаган', 'ігри нескорених'] },
    // Other groups
    { key: 'elderly_care', label: 'Допомога літнім людям', category: 'elderly', stems: ['літн', 'пенсіонер', 'похилого', 'догляд за', 'самотні'] },
    { key: 'disability_support', label: 'Підтримка людей з інвалідністю', category: 'disability', stems: ['інвалідн', 'особливими потреб', 'інклюз', 'доступн'] },
    { key: 'animal_help', label: 'Допомога тваринам, притулок', category: 'animals', stems: ['твари', 'притул', 'собак', 'кіт', 'котів', 'ветеринар', 'стерилізац'] },
    { key: 'community_events', label: 'Культурні та громадські заходи', category: 'community', stems: ['фестивал', 'концерт', 'вистав', 'культур', 'громадськ захід'] },
    { key: 'ecology', label: 'Екологічні ініціативи', category: 'ecology', stems: ['еколог', 'довкілл', 'дерев', 'сміття', 'прибиран'] },
];

export const SERVICE_KEYS = SERVICES.map(s => s.key);
export const serviceByKey = Object.fromEntries(SERVICES.map(s => [s.key, s]));
export const AUDIENCE_KEYS = Object.keys(AUDIENCES);

function stemHit(text, stem) {
    // A stem must start a word: "лік" matches "ліки", not "клініка"; "мобілізац" not "демобілізації".
    // Stems contain only letters, spaces, hyphens and apostrophes, so they are safe inside a RegExp.
    return new RegExp(`(^|[^\\p{L}])${stem}`, 'u').test(text);
}

/** Services and audiences mentioned in a free-text request (dictionary only). */
export function detectServices(text) {
    const t = ` ${String(text || '').toLowerCase()} `;
    const services = SERVICES.filter(s => s.stems.some(stem => stemHit(t, stem))).map(s => s.key);
    const audiences = Object.entries(AUDIENCES).filter(([, a]) => a.stems.some(stem => stemHit(t, stem))).map(([k]) => k);
    return { services, audiences };
}

export function cleanServiceList(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    return list
        .filter(s => s && SERVICE_KEYS.includes(s.key) && !seen.has(s.key) && seen.add(s.key))
        .map(s => ({
            key: s.key,
            quote: String(s.quote || '').trim().slice(0, 400) || null,
            source_url: String(s.source_url || '').trim().slice(0, 1000) || null,
            audiences: Array.isArray(s.audiences) ? s.audiences.filter(a => AUDIENCE_KEYS.includes(a)) : [],
        }));
}

/**
 * Evidence check for a bot-found service: the quote must itself say what is provided —
 * name the service ("психологічні консультації") or, if it is long enough, the people it is for.
 * A slogan like «Кожна історія заслуговує на сцену» proves nothing and is dropped.
 */
export function quoteSupports(key, quote) {
    const text = String(quote || '').toLowerCase();
    if (!text) return false;
    const found = detectServices(text);
    if (found.services.includes(key)) return true;
    return text.length >= 40 && found.audiences.length > 0;
}
