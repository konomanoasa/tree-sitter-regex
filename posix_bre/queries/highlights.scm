(ordinary_character) @string.regexp

(quoted_character) @string.escape

(backreference) @string.special.symbol

[
  (class_name)
  (collating_element_single)
  (collating_element_multi)
  (meta_character)
] @character.special

(one_char_or_coll_elem_bre
  "." @character.special)

(duplication_count) @number

[
  "\\("
  "\\)"
  "\\{"
  "\\}"
  "["
  "]"
] @punctuation.bracket

"," @punctuation.delimiter

[
  "^"
  "$"
  "*"
  "-"
] @operator

(range_expression
  "-" @string.regexp)

(bracket_list
  "-" @string.regexp)

(collating_symbol
  "." @punctuation.delimiter)

(equivalence_class
  "=" @punctuation.delimiter)

(character_class
  ":" @punctuation.delimiter)
