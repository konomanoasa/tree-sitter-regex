import { unicodeIdContinue, unicodeIdStart } from "./unicode.js";

function alternation(member) {
  return choice(
    member,
    seq(optional(member), repeat1(seq("|", optional(member)))),
  );
}

function classRange(start, end) {
  return seq(field("start", start), "-", field("end", end));
}

function bracedQuantifier($) {
  return seq(
    alias($._quantifier_open, "{"),
    choice(
      field("count", $.decimal_digits),
      seq(
        field("minimum", $.decimal_digits),
        ",",
        optional(field("maximum", $.decimal_digits)),
      ),
    ),
    "}",
  );
}

function unicodeEscape($) {
  return choice(
    seq(
      alias($._unicode_pair_start, "u"),
      $.hex_lead_surrogate,
      alias($._unicode_pair_separator, "\\u"),
      $.hex_trail_surrogate,
    ),
    seq(alias($._unicode_lead_start, "u"), $.hex_lead_surrogate),
    seq(alias($._unicode_trail_start, "u"), $.hex_trail_surrogate),
    seq(alias($._unicode_non_surrogate_start, "u"), $.hex_non_surrogate),
    seq(alias($._unicode_code_point_start, "u"), "{", $.code_point, "}"),
  );
}

function lookaround($, operators) {
  return seq("(", "?", operators, optional(field("body", $.disjunction)), ")");
}

export default function defineGrammar(name, mode) {
  const unicode = mode !== "ordinary";
  const sets = mode === "v";
  const atomName = unicode ? "atom" : "extended_atom";
  const identifierCharacters = (characters) =>
    new RustRegex(
      unicode ? characters : String.raw`[${characters}&&[\u{0}-\u{ffff}]]`,
    );
  const identifierChar = ($, character) =>
    choice(
      character,
      ...(!unicode ? [$.unicode_surrogate_pair] : []),
      seq(
        "\\",
        unicode
          ? $.reg_exp_unicode_escape_sequence
          : alias(
              $._identifier_unicode_escape_sequence,
              $.reg_exp_unicode_escape_sequence,
            ),
      ),
    );
  return grammar({
    name,
    extras: () => [],
    conflicts: ($) => [
      ...(unicode
        ? [
            [
              $.unicode_property_name_characters,
              $.unicode_property_value_character,
            ],
          ]
        : []),
      ...(!sets ? [[$.nonempty_class_ranges_no_dash]] : []),
    ],
    externals: ($) => [
      $._pattern_start,
      $._decimal_start,
      $._octal_zero,
      $._octal_nonzero,
      $._octal_zero_two,
      $._octal_four_two,
      $._octal_zero_three,
      $._identity_source,
      $._null_zero,
      $._hex_start,
      $._unicode_fixed_start,
      $._unicode_pair_start,
      $._unicode_lead_start,
      $._unicode_trail_start,
      $._unicode_non_surrogate_start,
      $._unicode_code_point_start,
      $._control_start,
      $._class_control_start,
      $._named_reference_start,
      $._literal_backslash,
      $._class_literal_backslash,
      $._literal_open_brace,
      $._quantifier_open,
      $._class_set_raw_character,
      $._class_intersection,
      $._class_subtraction,
      $._class_negation,
      $._unicode_pair_separator,
      $._error_sentinel,
    ],
    rules: {
      pattern: ($) =>
        unicode
          ? optional(field("body", $.disjunction))
          : seq($._pattern_start, optional(field("body", $.disjunction))),
      disjunction: ($) => alternation($.alternative),
      alternative: ($) => repeat1($.term),
      term: ($) =>
        choice(
          $.assertion,
          prec.right(
            seq(
              field("operand", $[atomName]),
              optional(field("quantifier", $.quantifier)),
            ),
          ),
          ...(!unicode
            ? [
                prec(
                  1,
                  seq(
                    field("operand", $.quantifiable_assertion),
                    field("quantifier", $.quantifier),
                  ),
                ),
              ]
            : []),
        ),
      assertion: ($) =>
        choice(
          "^",
          "$",
          "\\b",
          "\\B",
          ...(unicode
            ? [lookaround($, choice("=", "!"))]
            : [$.quantifiable_assertion]),
          lookaround($, choice("<=", "<!")),
        ),
      ...(!unicode
        ? { quantifiable_assertion: ($) => lookaround($, choice("=", "!")) }
        : {}),
      [atomName]: ($) =>
        choice(
          unicode ? $.pattern_character : $.extended_pattern_character,
          ".",
          seq("\\", $.atom_escape),
          $.character_class,
          seq(
            "(",
            optional($.group_specifier),
            optional(field("body", $.disjunction)),
            ")",
          ),
          seq(
            "(",
            "?",
            optional(field("enable", $.regular_expression_modifiers)),
            optional(
              seq(
                "-",
                optional(field("disable", $.regular_expression_modifiers)),
              ),
            ),
            ":",
            optional(field("body", $.disjunction)),
            ")",
          ),
          ...(!unicode
            ? [alias($._literal_backslash, "\\"), $.invalid_braced_quantifier]
            : []),
        ),
      [unicode ? "pattern_character" : "extended_pattern_character"]: ($) =>
        choice(
          alias(
            new RustRegex(
              unicode
                ? String.raw`[^$()*+.?\[\]^{|}\\]`
                : String.raw`[^$()*+.?\[^{|\\]`,
            ),
            $.source_character,
          ),
          alias("\0", $.source_character),
          ...(!unicode
            ? [alias($._literal_open_brace, $.source_character)]
            : []),
        ),
      group_specifier: ($) => seq("?", $.group_name),
      group_name: ($) =>
        seq("<", field("name", $.reg_exp_identifier_name), ">"),
      reg_exp_identifier_name: ($) =>
        prec.right(
          seq($.reg_exp_identifier_start, repeat($.reg_exp_identifier_part)),
        ),
      reg_exp_identifier_start: ($) =>
        identifierChar($, $.identifier_start_char),
      reg_exp_identifier_part: ($) => identifierChar($, $.identifier_part_char),
      identifier_start_char: ($) => choice($.unicode_id_start, "$", "_"),
      identifier_part_char: ($) => choice($.unicode_id_continue, "$"),
      unicode_id_start: () => identifierCharacters(unicodeIdStart),
      unicode_id_continue: () => identifierCharacters(unicodeIdContinue),
      ...(!unicode
        ? { unicode_surrogate_pair: () => /[\u{10000}-\u{10ffff}]/u }
        : {}),
      regular_expression_modifiers: ($) =>
        repeat1($.regular_expression_modifier),
      regular_expression_modifier: () => /[ims]/,
      quantifier: ($) => seq($.quantifier_prefix, optional("?")),
      quantifier_prefix: ($) => choice("*", "+", "?", bracedQuantifier($)),
      ...(!unicode ? { invalid_braced_quantifier: bracedQuantifier } : {}),
      decimal_digits: ($) => prec.right(repeat1($.decimal_digit)),
      decimal_digit: () => token(prec(1, /[0-9]/)),
      atom_escape: ($) =>
        choice(
          $.decimal_escape,
          $.character_class_escape,
          $.character_escape,
          seq(alias($._named_reference_start, "k"), $.group_name),
        ),
      decimal_escape: ($) =>
        prec.right(
          seq(
            alias($._decimal_start, $.non_zero_digit),
            optional($.decimal_digits),
          ),
        ),
      character_escape: ($) =>
        choice(
          $.control_escape,
          seq(alias($._control_start, "c"), $.ascii_letter),
          alias($._null_zero, "0"),
          $.hex_escape_sequence,
          $.reg_exp_unicode_escape_sequence,
          $.identity_escape,
          ...(!unicode ? [$.legacy_octal_escape_sequence] : []),
        ),
      control_escape: () => /[fnrtv]/,
      ascii_letter: () => /[A-Za-z]/,
      hex_escape_sequence: ($) =>
        seq(alias($._hex_start, "x"), $.hex_digit, $.hex_digit),
      reg_exp_unicode_escape_sequence: ($) =>
        unicode
          ? unicodeEscape($)
          : seq(alias($._unicode_fixed_start, "u"), $.hex4_digits),
      ...(!unicode
        ? { _identifier_unicode_escape_sequence: unicodeEscape }
        : {}),
      hex_lead_surrogate: ($) => $.hex4_digits,
      hex_trail_surrogate: ($) => $.hex4_digits,
      hex_non_surrogate: ($) => $.hex4_digits,
      hex4_digits: ($) =>
        seq($.hex_digit, $.hex_digit, $.hex_digit, $.hex_digit),
      code_point: ($) => $.hex_digits,
      hex_digits: ($) => prec.right(repeat1($.hex_digit)),
      hex_digit: () => /[0-9A-Fa-f]/,
      identity_escape: ($) =>
        unicode
          ? choice($.syntax_character, "/")
          : $.source_character_identity_escape,
      syntax_character: () => token(choice(..."^$\\.*+?()[]{}|")),
      ...(!unicode
        ? {
            source_character_identity_escape: ($) =>
              alias($._identity_source, $.source_character),
            legacy_octal_escape_sequence: ($) =>
              choice(
                alias($._octal_zero, "0"),
                $.non_zero_octal_digit,
                seq(alias($._octal_zero_two, $.zero_to_three), $.octal_digit),
                seq(alias($._octal_four_two, $.four_to_seven), $.octal_digit),
                seq(
                  alias($._octal_zero_three, $.zero_to_three),
                  $.octal_digit,
                  $.octal_digit,
                ),
              ),
            non_zero_octal_digit: ($) => alias($._octal_nonzero, $.octal_digit),
            octal_digit: () => /[0-7]/,
          }
        : {}),
      character_class_escape: ($) =>
        unicode
          ? choice(
              /[dDsSwW]/,
              seq(
                choice("p", "P"),
                "{",
                $.unicode_property_value_expression,
                "}",
              ),
            )
          : /[dDsSwW]/,
      ...(unicode
        ? {
            unicode_property_value_expression: ($) =>
              choice(
                seq($.unicode_property_name, "=", $.unicode_property_value),
                $.lone_unicode_property_name_or_value,
              ),
            unicode_property_name: ($) => $.unicode_property_name_characters,
            unicode_property_name_characters: ($) =>
              repeat1($.unicode_property_name_character),
            unicode_property_name_character: ($) => choice($.ascii_letter, "_"),
            unicode_property_value: ($) => $.unicode_property_value_characters,
            lone_unicode_property_name_or_value: ($) =>
              $.unicode_property_value_characters,
            unicode_property_value_characters: ($) =>
              repeat1($.unicode_property_value_character),
            unicode_property_value_character: ($) =>
              choice($.unicode_property_name_character, $.decimal_digit),
          }
        : {}),
      character_class: ($) =>
        seq(
          "[",
          optional(sets ? alias($._class_negation, "^") : "^"),
          optional(sets ? $.class_set_expression : $.nonempty_class_ranges),
          "]",
        ),
      ...(!sets
        ? {
            nonempty_class_ranges: ($) =>
              choice(
                seq(repeat1($._class_range), optional($._class_tail)),
                $._class_tail,
              ),
            _class_range: ($) => classRange($.class_atom, $.class_atom),
            _class_tail: ($) =>
              seq($.class_atom, optional($.nonempty_class_ranges_no_dash)),
            nonempty_class_ranges_no_dash: ($) =>
              seq(
                repeat($.class_atom_no_dash),
                choice(
                  $.class_atom,
                  seq(
                    classRange($.class_atom_no_dash, $.class_atom),
                    optional($.nonempty_class_ranges),
                  ),
                ),
              ),
            class_atom: ($) => choice("-", $.class_atom_no_dash),
            class_atom_no_dash: ($) =>
              choice(
                alias(new RustRegex(String.raw`[^\\\]-]`), $.source_character),
                alias("\0", $.source_character),
                seq("\\", $.class_escape),
                ...(!unicode ? [alias($._class_literal_backslash, "\\")] : []),
              ),
            class_escape: ($) =>
              choice(
                "b",
                $.character_class_escape,
                $.character_escape,
                ...(unicode
                  ? ["-"]
                  : [
                      seq(
                        alias($._class_control_start, "c"),
                        $.class_control_letter,
                      ),
                    ]),
              ),
            ...(!unicode
              ? { class_control_letter: ($) => choice($.decimal_digit, "_") }
              : {}),
          }
        : {
            class_set_expression: ($) =>
              choice($.class_union, $.class_intersection, $.class_subtraction),
            class_union: ($) =>
              repeat1(choice($.class_set_range, $.class_set_operand)),
            class_intersection: ($) =>
              seq(
                $.class_set_operand,
                repeat1(
                  seq(alias($._class_intersection, "&&"), $.class_set_operand),
                ),
              ),
            class_subtraction: ($) =>
              seq(
                $.class_set_operand,
                repeat1(
                  seq(alias($._class_subtraction, "--"), $.class_set_operand),
                ),
              ),
            class_set_range: ($) =>
              classRange($.class_set_character, $.class_set_character),
            class_set_operand: ($) =>
              choice(
                $.nested_class,
                $.class_string_disjunction,
                $.class_set_character,
              ),
            nested_class: ($) =>
              choice(
                seq(
                  "[",
                  optional(alias($._class_negation, "^")),
                  optional($.class_set_expression),
                  "]",
                ),
                seq("\\", $.character_class_escape),
              ),
            class_string_disjunction: ($) =>
              seq(
                "\\q",
                "{",
                optional($.class_string_disjunction_contents),
                "}",
              ),
            class_string_disjunction_contents: ($) =>
              alternation($.non_empty_class_string),
            non_empty_class_string: ($) => repeat1($.class_set_character),
            class_set_character: ($) =>
              choice(
                alias($._class_set_raw_character, $.source_character),
                seq("\\", $.character_escape),
                seq("\\", $.class_set_reserved_punctuator),
                "\\b",
              ),
            class_set_reserved_punctuator: () => /[&\-!#%,:;<=>@`~]/,
          }),
    },
  });
}
