/**
 * germanGrammarTips.ts — Multilingual German grammar tips
 *
 * Keyed by tip type (tipKey). Each tip has text in es/en/de/fr.
 * Used in GrammarTipModal to show contextual hints.
 */

export type TipLang = 'es' | 'en' | 'de' | 'fr'
export type TipKey =
  | 'noun_article'
  | 'nominative'
  | 'accusative'
  | 'dative'
  | 'genitive'
  | 'adj_strong'
  | 'adj_weak'
  | 'adj_mixed'
  | 'wechselpraep'
  | 'akkusativ_praep'
  | 'dativ_praep'
  | 'verb_preps'
  | 'hauptsatz_order'
  | 'nebensatz_order'
  | 'dativ_vor_akkusativ'
  | 'wann_wo_warum_wie'

export interface GrammarTip {
  title: Record<TipLang, string>
  body: Record<TipLang, string>
  /** Optional case table: rows of [form, masc, fem, neut, plural] */
  table?: {
    headers: Record<TipLang, string[]>
    rows: string[][]
  }
}

export const GRAMMAR_TIPS: Record<TipKey, GrammarTip> = {
  noun_article: {
    title: {
      es: 'Artículos alemanes: der / die / das',
      en: 'German articles: der / die / das',
      de: 'Deutsche Artikel: der / die / das',
      fr: 'Articles allemands: der / die / das',
    },
    body: {
      es: 'En alemán los sustantivos tienen tres géneros: masculino (der), femenino (die) y neutro (das). El artículo cambia según el caso gramatical. ¡Siempre aprende el artículo junto con el sustantivo!',
      en: 'German nouns have three genders: masculine (der), feminine (die) and neuter (das). The article changes based on grammatical case. Always learn the article together with the noun!',
      de: 'Deutsches Substantive haben drei Genera: maskulin (der), feminin (die) und neutrum (das). Der Artikel ändert sich je nach Kasus. Lerne immer den Artikel zusammen mit dem Substantiv!',
      fr: 'Les substantifs allemands ont trois genres: masculin (der), féminin (die) et neutre (das). L\'article change selon le cas grammatical. Apprenez toujours l\'article avec le substantif!',
    },
    table: {
      headers: {
        es: ['Caso', 'Masc.', 'Fem.', 'Neutro', 'Plural'],
        en: ['Case', 'Masc.', 'Fem.', 'Neuter', 'Plural'],
        de: ['Kasus', 'Mask.', 'Fem.', 'Neutr.', 'Plural'],
        fr: ['Cas', 'Masc.', 'Fém.', 'Neutre', 'Pluriel'],
      },
      rows: [
        ['Nom.', 'der', 'die', 'das', 'die'],
        ['Akk.', 'den', 'die', 'das', 'die'],
        ['Dat.', 'dem', 'der', 'dem', 'den'],
        ['Gen.', 'des', 'der', 'des', 'der'],
      ],
    },
  },

  nominative: {
    title: {
      es: 'Nominativo — el sujeto',
      en: 'Nominative — the subject',
      de: 'Nominativ — das Subjekt',
      fr: 'Nominatif — le sujet',
    },
    body: {
      es: 'El nominativo es el caso del sujeto: quien realiza la acción. Artículo: der (m), die (f), das (n), die (pl). Ejemplo: **Der Mann** schläft.',
      en: 'Nominative is the subject case: who performs the action. Article: der (m), die (f), das (n), die (pl). Example: **Der Mann** schläft.',
      de: 'Der Nominativ ist der Fall des Subjekts: wer die Handlung ausführt. Artikel: der (m), die (f), das (n), die (Pl). Beispiel: **Der Mann** schläft.',
      fr: 'Le nominatif est le cas du sujet: qui effectue l\'action. Article: der (m), die (f), das (n), die (pl). Exemple: **Der Mann** schläft.',
    },
  },

  accusative: {
    title: {
      es: 'Acusativo — objeto directo',
      en: 'Accusative — direct object',
      de: 'Akkusativ — direktes Objekt',
      fr: 'Accusatif — objet direct',
    },
    body: {
      es: 'El acusativo es el caso del objeto directo (¿qué? / ¿a quién?). Solo el masculino cambia: der→**den**, die→die, das→das. Ejemplo: Ich sehe **den** Mann.',
      en: 'Accusative is the direct object case (what? / whom?). Only masculine changes: der→**den**, die→die, das→das. Example: Ich sehe **den** Mann.',
      de: 'Der Akkusativ ist der Fall des direkten Objekts (wen? / was?). Nur Maskulinum ändert sich: der→**den**, die→die, das→das. Beispiel: Ich sehe **den** Mann.',
      fr: 'L\'accusatif est le cas de l\'objet direct (quoi? / qui?). Seul le masculin change: der→**den**, die→die, das→das. Exemple: Ich sehe **den** Mann.',
    },
    table: {
      headers: {
        es: ['', 'Masc.', 'Fem.', 'Neutro', 'Plural'],
        en: ['', 'Masc.', 'Fem.', 'Neuter', 'Plural'],
        de: ['', 'Mask.', 'Fem.', 'Neutr.', 'Plural'],
        fr: ['', 'Masc.', 'Fém.', 'Neutre', 'Pluriel'],
      },
      rows: [
        ['Nom.', 'der', 'die', 'das', 'die'],
        ['Akk.', '**den**', 'die', 'das', 'die'],
      ],
    },
  },

  dative: {
    title: {
      es: 'Dativo — objeto indirecto',
      en: 'Dative — indirect object',
      de: 'Dativ — indirektes Objekt',
      fr: 'Datif — objet indirect',
    },
    body: {
      es: 'El dativo indica el objeto indirecto (¿a quién?/¿para quién?). Artículos: dem (m/n), der (f), den+n (pl). Ejemplo: Ich gebe **dem** Mann das Buch.',
      en: 'Dative marks the indirect object (to whom? / for whom?). Articles: dem (m/n), der (f), den+n (pl). Example: Ich gebe **dem** Mann das Buch.',
      de: 'Der Dativ kennzeichnet das indirekte Objekt (wem?). Artikel: dem (m/n), der (f), den+n (Pl). Beispiel: Ich gebe **dem** Mann das Buch.',
      fr: 'Le datif marque l\'objet indirect (à qui? / pour qui?). Articles: dem (m/n), der (f), den+n (pl). Exemple: Ich gebe **dem** Mann das Buch.',
    },
    table: {
      headers: {
        es: ['Caso', 'Masc.', 'Fem.', 'Neutro', 'Plural'],
        en: ['Case', 'Masc.', 'Fem.', 'Neuter', 'Plural'],
        de: ['Kasus', 'Mask.', 'Fem.', 'Neutr.', 'Plural'],
        fr: ['Cas', 'Masc.', 'Fém.', 'Neutre', 'Pluriel'],
      },
      rows: [
        ['Dat.', '**dem**', '**der**', '**dem**', '**den**+n'],
      ],
    },
  },

  genitive: {
    title: {
      es: 'Genitivo — posesión',
      en: 'Genitive — possession',
      de: 'Genitiv — Besitz',
      fr: 'Génitif — possession',
    },
    body: {
      es: 'El genitivo expresa posesión o pertenencia. Artículos: des+s/es (m/n), der (f), der (pl). Ejemplo: Das Auto **des** Mannes. Nota: en el habla cotidiana se usa mucho "von" en su lugar.',
      en: 'Genitive expresses possession. Articles: des+s/es (m/n), der (f), der (pl). Example: Das Auto **des** Mannes. Note: in everyday speech "von" is often used instead.',
      de: 'Der Genitiv drückt Zugehörigkeit aus. Artikel: des+s/es (m/n), der (f), der (Pl). Beispiel: Das Auto **des** Mannes. Im Alltag wird oft "von" statt Genitiv verwendet.',
      fr: 'Le génitif exprime la possession. Articles: des+s/es (m/n), der (f), der (pl). Exemple: Das Auto **des** Mannes. Dans le langage courant, "von" est souvent utilisé à la place.',
    },
  },

  adj_strong: {
    title: {
      es: 'Declinación fuerte de adjetivos',
      en: 'Strong adjective declension',
      de: 'Starke Adjektivdeklination',
      fr: 'Déclinaison forte des adjectifs',
    },
    body: {
      es: 'Se usa cuando NO hay artículo antes del adjetivo. El adjetivo lleva la información de género/caso. Ejemplo: **Kalter** Kaffee schmeckt nicht (nom. masc.). El adjetivo termina como el artículo definido.',
      en: 'Used when there is NO article before the adjective. The adjective carries the gender/case info. Example: **Kalter** Kaffee schmeckt nicht (nom. masc.). Adjective ends like the definite article.',
      de: 'Wird verwendet, wenn KEIN Artikel vor dem Adjektiv steht. Das Adjektiv trägt die Genus-/Kasusmerkmal. Beispiel: **Kalter** Kaffee schmeckt nicht (Nom. mask.).',
      fr: 'Utilisée quand il n\'y a PAS d\'article avant l\'adjectif. L\'adjectif porte l\'information de genre/cas. Exemple: **Kalter** Kaffee schmeckt nicht (nom. masc.).',
    },
  },

  adj_weak: {
    title: {
      es: 'Declinación débil de adjetivos',
      en: 'Weak adjective declension',
      de: 'Schwache Adjektivdeklination',
      fr: 'Déclinaison faible des adjectifs',
    },
    body: {
      es: 'Se usa después de artículo definido (der/die/das). El adjetivo termina en -e o -en. Nominativo sing.: -e para todos los géneros. Todo lo demás: -en. Ejemplo: der alt**e** Mann / des alt**en** Mannes.',
      en: 'Used after definite article (der/die/das). Adjective ends in -e or -en. Nominative sing.: -e for all genders. Everything else: -en. Example: der alt**e** Mann / des alt**en** Mannes.',
      de: 'Nach bestimmtem Artikel (der/die/das). Nom. Sing.: -e. Alle anderen Formen: -en. Beispiel: der alt**e** Mann / des alt**en** Mannes.',
      fr: 'Après article défini (der/die/das). Nom. sing.: -e pour tous les genres. Tout le reste: -en. Exemple: der alt**e** Mann / des alt**en** Mannes.',
    },
  },

  adj_mixed: {
    title: {
      es: 'Declinación mixta de adjetivos',
      en: 'Mixed adjective declension',
      de: 'Gemischte Adjektivdeklination',
      fr: 'Déclinaison mixte des adjectifs',
    },
    body: {
      es: 'Se usa después de artículo indefinido (ein/eine/kein). Nominativo y acusativo neutro/nominativo fem.: terminaciones fuertes. Resto: terminaciones débiles (-en). Ejemplo: ein alt**er** Mann (nom.), ein**em** alt**en** Mann (dat.).',
      en: 'Used after indefinite article (ein/eine/kein). Nom. & acc. neuter / nom. fem.: strong endings. Rest: weak (-en). Example: ein alt**er** Mann (nom.), ein**em** alt**en** Mann (dat.).',
      de: 'Nach unbestimmtem Artikel (ein/eine/kein). Nom. und Akk. Neutrum / Nom. Fem.: starke Endungen. Rest: schwache Endungen (-en). Beispiel: ein alt**er** Mann (Nom.).',
      fr: 'Après article indéfini (ein/eine/kein). Nom. & acc. neutre / nom. fém.: terminaisons fortes. Reste: faibles (-en). Exemple: ein alt**er** Mann (nom.).',
    },
  },

  wechselpraep: {
    title: {
      es: 'Wechselpräpositionen — Richtung vs. Lage',
      en: 'Two-way prepositions — direction vs. location',
      de: 'Wechselpräpositionen — Richtung vs. Ort',
      fr: 'Prépositions à double régime — direction vs. lieu',
    },
    body: {
      es: 'Las preposiciones an, auf, in, über, unter, vor, hinter, neben, zwischen pueden ir con acusativo (movimiento/dirección) o dativo (posición/estado). Truco: ¿Wohin? → Akk. / ¿Wo? → Dat.',
      en: 'The prepositions an, auf, in, über, unter, vor, hinter, neben, zwischen can take accusative (movement/direction) or dative (position/state). Trick: Wohin? → Akk. / Wo? → Dat.',
      de: 'Die Präpositionen an, auf, in, über, unter, vor, hinter, neben, zwischen stehen mit Akkusativ (Richtung/Bewegung) oder Dativ (Ort/Zustand). Merkhilfe: Wohin? → Akk. / Wo? → Dat.',
      fr: 'Les prépositions an, auf, in, über, unter, vor, hinter, neben, zwischen peuvent prendre l\'accusatif (mouvement) ou le datif (position). Astuce: Wohin? → Akk. / Wo? → Dat.',
    },
    table: {
      headers: {
        es: ['Pregunta', 'Caso', 'Ejemplo'],
        en: ['Question', 'Case', 'Example'],
        de: ['Frage', 'Kasus', 'Beispiel'],
        fr: ['Question', 'Cas', 'Exemple'],
      },
      rows: [
        ['Wohin? (direction)', 'Akkusativ', 'Er geht in den Park'],
        ['Wo? (location)', 'Dativ', 'Er ist in dem (im) Park'],
      ],
    },
  },

  akkusativ_praep: {
    title: {
      es: 'Preposiciones con acusativo',
      en: 'Accusative prepositions',
      de: 'Präpositionen mit Akkusativ',
      fr: 'Prépositions avec accusatif',
    },
    body: {
      es: 'Estas preposiciones van SIEMPRE con acusativo:\ndurch (por/a través de), für (para), gegen (contra), ohne (sin), um (alrededor de), bis (hasta), entlang (a lo largo de).\nMemo: **d**urch **f**ür **g**egen **o**hne **u**m = "df gou"',
      en: 'These prepositions ALWAYS take accusative:\ndurch (through), für (for), gegen (against), ohne (without), um (around), bis (until), entlang (along).\nMemo: **d**urch **f**ür **g**egen **o**hne **u**m = "df gou"',
      de: 'Diese Präpositionen stehen IMMER mit Akkusativ:\ndurch, für, gegen, ohne, um, bis, entlang.\nMerksatz: **d**urch **f**ür **g**egen **o**hne **u**m',
      fr: 'Ces prépositions prennent TOUJOURS l\'accusatif:\ndurch, für, gegen, ohne, um, bis, entlang.\nMoyen mnémotechnique: durch für gegen ohne um',
    },
  },

  dativ_praep: {
    title: {
      es: 'Preposiciones con dativo',
      en: 'Dative prepositions',
      de: 'Präpositionen mit Dativ',
      fr: 'Prépositions avec datif',
    },
    body: {
      es: 'Estas preposiciones van SIEMPRE con dativo:\naus, bei, gegenüber, mit, nach, seit, von, zu, außer, ab.\nMemo: "aus bei mit nach seit von zu" — las más comunes.',
      en: 'These prepositions ALWAYS take dative:\naus, bei, gegenüber, mit, nach, seit, von, zu, außer, ab.\nMemo: "aus bei mit nach seit von zu" — the most common ones.',
      de: 'Diese Präpositionen stehen IMMER mit Dativ:\naus, bei, gegenüber, mit, nach, seit, von, zu, außer, ab.\nMerksatz: "aus bei mit nach seit von zu"',
      fr: 'Ces prépositions prennent TOUJOURS le datif:\naus, bei, gegenüber, mit, nach, seit, von, zu, außer, ab.',
    },
  },

  verb_preps: {
    title: {
      es: 'Verbos con preposición fija',
      en: 'Verbs with fixed prepositions',
      de: 'Verben mit festen Präpositionen',
      fr: 'Verbes avec prépositions fixes',
    },
    body: {
      es: 'Algunos verbos alemanes exigen siempre la misma preposición + caso:\n• warten **auf** + Akk. (esperar a)\n• denken **an** + Akk. (pensar en)\n• sich freuen **auf** + Akk. (alegrarse por)\n• fragen **nach** + Dat. (preguntar por)\n• sprechen **über** + Akk. (hablar sobre)\n• danken **für** + Akk. (agradecer por)\n• sorgen **für** + Akk. (cuidar de)\nEstas combinaciones se aprenden de memoria.',
      en: 'Some German verbs always require the same preposition + case:\n• warten **auf** + Akk. (to wait for)\n• denken **an** + Akk. (to think about)\n• sich freuen **auf** + Akk. (to look forward to)\n• fragen **nach** + Dat. (to ask about)\n• sprechen **über** + Akk. (to talk about)\n• danken **für** + Akk. (to thank for)\n• sorgen **für** + Akk. (to take care of)\nThese combinations must be memorized.',
      de: 'Manche Verben verlangen immer dieselbe Präposition + Kasus:\n• warten **auf** + Akk.\n• denken **an** + Akk.\n• sich freuen **auf** + Akk.\n• fragen **nach** + Dat.\n• sprechen **über** + Akk.\n• danken **für** + Akk.\n• sorgen **für** + Akk.\nDiese Verbindungen lernt man auswendig.',
      fr: 'Certains verbes allemands exigent toujours la même préposition + cas:\n• warten **auf** + Akk.\n• denken **an** + Akk.\n• sich freuen **auf** + Akk.\n• fragen **nach** + Dat.\n• sprechen **über** + Akk.\n• danken **für** + Akk.\nCes combinaisons s\'apprennent par cœur.',
    },
  },

  hauptsatz_order: {
    title: {
      es: 'Orden en oración principal (Hauptsatz)',
      en: 'Word order in main clause (Hauptsatz)',
      de: 'Wortstellung im Hauptsatz',
      fr: 'Ordre des mots dans la proposition principale',
    },
    body: {
      es: 'En alemán el verbo conjugado ocupa SIEMPRE la segunda posición en la oración principal:\n[Posición 1] [VERBO] [Sujeto si no está en pos.1] [...]\nEjemplo: Heute **gehe** ich ins Kino.\nRegla Zeit-Art-Ort: tiempo → modo → lugar:\nIch fahre **morgen** (Zeit) **mit dem Zug** (Art) **nach Berlin** (Ort).',
      en: 'In German the conjugated verb ALWAYS occupies second position in a main clause:\n[Position 1] [VERB] [Subject if not in pos.1] [...]\nExample: Heute **gehe** ich ins Kino.\nTime-Manner-Place rule: time → manner → place:\nIch fahre **morgen** (time) **mit dem Zug** (manner) **nach Berlin** (place).',
      de: 'Das konjugierte Verb steht IMMER auf Position 2 im Hauptsatz:\n[Pos. 1] [VERB] [Subjekt falls nicht auf Pos. 1] [...]\nBeispiel: Heute **gehe** ich ins Kino.\nRegel: Zeit – Art – Ort (TeKaMoLo)',
      fr: 'En allemand le verbe conjugué est TOUJOURS en deuxième position dans la proposition principale:\n[Position 1] [VERBE] [Sujet si pas en pos. 1] [...]\nExemple: Heute **gehe** ich ins Kino.\nRègle: Temps – Manière – Lieu',
    },
  },

  nebensatz_order: {
    title: {
      es: 'Orden en oración subordinada (Nebensatz)',
      en: 'Word order in subordinate clause (Nebensatz)',
      de: 'Wortstellung im Nebensatz',
      fr: 'Ordre des mots dans la proposition subordonnée',
    },
    body: {
      es: 'En las oraciones subordinadas el verbo conjugado va al FINAL.\nConjunciones que subordinan: weil, dass, wenn, obwohl, damit, ob, als, während, bevor, nachdem...\nEjemplo: Ich komme nicht, weil ich krank **bin**.\nEn el perfecto: Ich weiß, dass er gekommen **ist**.',
      en: 'In subordinate clauses the conjugated verb goes to the END.\nSubordinating conjunctions: weil, dass, wenn, obwohl, damit, ob, als, während, bevor, nachdem...\nExample: Ich komme nicht, weil ich krank **bin**.\nIn perfect tense: Ich weiß, dass er gekommen **ist**.',
      de: 'Im Nebensatz steht das konjugierte Verb am ENDE.\nSubordinierende Konjunktionen: weil, dass, wenn, obwohl, damit, ob, als, während...\nBeispiel: Ich komme nicht, weil ich krank **bin**.\nIm Perfekt: Ich weiß, dass er gekommen **ist**.',
      fr: 'Dans les propositions subordonnées, le verbe conjugué va à la FIN.\nConjonctions de subordination: weil, dass, wenn, obwohl, damit, ob, als, während...\nExemple: Ich komme nicht, weil ich krank **bin**.',
    },
  },

  dativ_vor_akkusativ: {
    title: {
      es: 'Dativo antes que Acusativo',
      en: 'Dative before Accusative',
      de: 'Dativ vor Akkusativ',
      fr: 'Datif avant Accusatif',
    },
    body: {
      es: 'Cuando hay dos objetos sustantivos, el dativo va primero:\nIch gebe **dem Mann** (Dat.) **das Buch** (Akk.).\nPero si el objeto acusativo es un pronombre, va primero:\nIch gebe **es** (Akk. pron.) **dem Mann** (Dat.).\nRegla: sustantivo→Dat primero / pronombre acusativo→primero.',
      en: 'When there are two noun objects, dative comes first:\nIch gebe **dem Mann** (Dat.) **das Buch** (Akk.).\nBut if the accusative object is a pronoun, it comes first:\nIch gebe **es** (Akk. pron.) **dem Mann** (Dat.).\nRule: noun→Dat first / accusative pronoun→first.',
      de: 'Bei zwei Substantivobjekten kommt der Dativ zuerst:\nIch gebe **dem Mann** (Dat.) **das Buch** (Akk.).\nAber bei Pronomen im Akkusativ kommt dieses zuerst:\nIch gebe **es** (Akk. Pron.) **dem Mann** (Dat.).',
      fr: 'Quand il y a deux objets nominaux, le datif vient en premier:\nIch gebe **dem Mann** (Dat.) **das Buch** (Akk.).\nMais si l\'objet accusatif est un pronom, il vient en premier.',
    },
  },

  wann_wo_warum_wie: {
    title: {
      es: 'Orden de adverbios: Wann–Wie–Wo (Zeit–Art–Ort)',
      en: 'Adverb order: When–How–Where (Zeit–Art–Ort)',
      de: 'Reihenfolge der Adverbialien: Zeit–Art–Ort (TeKaMoLo)',
      fr: 'Ordre des adverbes: Quand–Comment–Où',
    },
    body: {
      es: 'El orden natural de los complementos circunstanciales en alemán es:\n**Zeit** (cuándo) → **Art/Weise** (cómo) → **Ort** (dónde)\nEjemplo: Er fährt **morgen** (Zeit) **mit dem Auto** (Art) **nach München** (Ort).\nMemo: TeKaMoLo = **Te**mporal, **Ka**usal, **Mo**dal, **Lo**kal.',
      en: 'The natural order of adverbial complements in German is:\n**Zeit** (when) → **Art** (how) → **Ort** (where)\nExample: Er fährt **morgen** (when) **mit dem Auto** (how) **nach München** (where).\nMemo: TeKaMoLo = **Te**mporal, **Ka**usal, **Mo**dal, **Lo**kal.',
      de: 'Die natürliche Reihenfolge von Adverbialen ist:\n**Zeit** → **Art/Weise** → **Ort**\nBeispiel: Er fährt **morgen** (Zeit) **mit dem Auto** (Art) **nach München** (Ort).\nMerkwort: TeKaMoLo',
      fr: 'L\'ordre naturel des compléments circonstanciels en allemand est:\n**Temps** → **Manière** → **Lieu**\nExemple: Er fährt **morgen** (temps) **mit dem Auto** (manière) **nach München** (lieu).',
    },
  },
}

/** Get a tip by key, returning null if not found. */
export function getTip(key: string): GrammarTip | null {
  return GRAMMAR_TIPS[key as TipKey] ?? null
}
