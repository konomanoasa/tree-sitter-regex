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
  "?"
  "-"
  "="
  "!"
  "<="
  "<!"
] @operator

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

(extended_atom
  "\\" @string.regexp)

(extended_atom
  "\\" @string.escape
  (atom_escape
    (character_escape)))

(extended_atom
  "\\" @string.escape
  (atom_escape
    (decimal_escape)))

(class_atom_no_dash
  "\\" @string.regexp)

(class_atom_no_dash
  "\\" @string.escape
  (class_escape))

(decimal_escape
  (decimal_digits
    (decimal_digit) @string.escape))

(group_specifier
  "?" @punctuation.special)

(assertion
  "?" @punctuation.special)

(extended_atom
  "?" @punctuation.special)

(atom_escape
  "k" @punctuation.special)

(extended_atom
  "\\" @punctuation.special
  (atom_escape
    "k"))

(extended_atom
  "\\" @character.special
  (atom_escape
    (character_class_escape)))

(character_class_escape) @character.special

[
  (octal_digit)
  (zero_to_three)
  (four_to_seven)
] @string.escape

(source_character_identity_escape
  (source_character) @string.escape)

(class_escape
  "b" @string.escape)

(class_control_letter
  [
    "_"
    (decimal_digit)
  ] @string.escape)

(quantifiable_assertion
  "?" @punctuation.special)

(class_atom
  "-" @string.regexp)

(class_atom_no_dash
  "\\" @character.special
  (class_escape
    (character_class_escape)))
