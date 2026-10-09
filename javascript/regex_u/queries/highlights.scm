(source_character) @string.regexp

"." @character.special

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
  "<"
  ">"
] @punctuation.bracket

[
  ":"
  ","
] @punctuation.delimiter

[
  "|"
  "^"
  "$"
  "\\b"
  "\\B"
  "*"
  "+"
  "-"
  "="
  "!"
  "<="
  "<!"
] @operator

"?" @punctuation.special

(decimal_digit) @number

(regular_expression_modifier) @keyword.modifier

[
  (unicode_id_start)
  (unicode_id_continue)
] @label

(identifier_start_char
  [
    "$"
    "_"
  ] @label)

(identifier_part_char
  "$" @label)

[
  "\\"
  "\\u"
  "0"
  "c"
  "u"
  "x"
  (ascii_letter)
  (control_escape)
  (hex_digit)
  (non_zero_digit)
] @string.escape

(decimal_escape
  (decimal_digits
    (decimal_digit) @string.escape))

(quantifier_prefix
  "?" @operator)

(quantifier
  "?" @operator)

(atom_escape
  "k" @punctuation.special)

(atom
  "\\" @punctuation.special
  (atom_escape
    "k"))

(atom
  "\\" @character.special
  (atom_escape
    (character_class_escape)))

((character_class_escape) @character.special
  (#any-of? @character.special "d" "D" "s" "S" "w" "W"))

[
  "/"
  (syntax_character)
] @string.escape

(character_class_escape
  [
    "p"
    "P"
  ] @character.special)

(unicode_property_name_character
  [
    (ascii_letter)
    "_"
  ] @character.special)

(unicode_property_value_character
  (decimal_digit) @character.special)

(class_atom
  "-" @string.regexp)

(class_atom_no_dash
  "\\" @character.special
  (class_escape
    (character_class_escape)))

(class_escape
  [
    "b"
    "-"
  ] @string.escape)
