import type { Language } from "tree-sitter";

type RegexLanguage = Language & {
  HIGHLIGHTS_QUERY: string;
};

export declare const ecmaregex: RegexLanguage;
export declare const ecmaregex_u: RegexLanguage;
export declare const ecmaregex_v: RegexLanguage;
export declare const pcre2: RegexLanguage;
export declare const posix_bre: RegexLanguage;
export declare const posix_ere: RegexLanguage;
export declare const pyregex: RegexLanguage;
export declare const pyregex_verbose: RegexLanguage;
