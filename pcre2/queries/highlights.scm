[
  (literal_character)
  (class_character)
] @string.regexp

[
  (character_class_escape)
  (property_escape)
  (property_name)
  (class_name)
] @character.special

(wildcard
  "." @character.special)

[
  (literal_escape)
  (control_escape)
  (backspace_escape)
  (control_character)
  (hexadecimal_digits)
  (octal_digits)
  "\\"
  "\\x"
  "\\N"
  "\\o"
  "\\c"
  "U+"
] @string.escape

[
  (group_name)
  (group_number)
  (condition_name)
  (verb_argument)
] @label

(decimal_digits) @number

[
  (flag_set)
  (option_name)
] @keyword.modifier

[
  (verb_name)
  (define_condition)
  "atomic"
  "pla"
  "positive_lookahead"
  "nla"
  "negative_lookahead"
  "plb"
  "positive_lookbehind"
  "nlb"
  "negative_lookbehind"
  "napla"
  "non_atomic_positive_lookahead"
  "naplb"
  "non_atomic_positive_lookbehind"
  "sr"
  "script_run"
  "asr"
  "atomic_script_run"
  "scs"
  "scan_substring"
  "VERSION"
  "R"
] @keyword

[
  (comment_content)
  (verbose_comment)
] @comment

(callout_content) @string

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
  "<"
  ">"
  "'"
  "\""
  "`"
  "%"
  "#"
] @punctuation.bracket

[
  ","
  ":"
] @punctuation.delimiter

[
  (quote_start)
  (quote_end)
  "?"
  "?P"
  "?C"
  "*"
  "\\g"
  "\\k"
] @punctuation.special

[
  (anchor_escape)
  (word_boundary_escape)
  (match_reset)
  "|"
  "^"
  "$"
  "-"
  "+"
  "="
  "!"
  "<="
  "<!"
  "<*"
  ">="
  "&"
] @operator

(atomic_group
  ">" @operator)

(subroutine_call
  "?P"
  ">" @operator)

(quantifier
  [
    "*"
    "?"
  ] @operator)

(non_atomic_lookahead_assertion
  "?"
  "*" @operator)

(numeric_backreference
  group: (group_number) @string.escape)

(callout_string
  [
    "^"
    "$"
  ] @punctuation.bracket)

(comment_group
  "#" @comment)

(word_boundary_assertion
  [
    "["
    "]"
    ":"
    "<"
    ">"
  ] @operator)

(start_option
  "=" @punctuation.delimiter)

(version_condition
  "." @punctuation.delimiter)
