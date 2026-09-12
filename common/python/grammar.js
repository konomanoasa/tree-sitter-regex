import { alternation, classRange } from "../grammar.js";

const TWO_HEXADECIMAL_DIGITS = /[0-9A-Fa-f]{2}/;
const FOUR_HEXADECIMAL_DIGITS = /[0-9A-Fa-f]{4}/;
const EIGHT_HEXADECIMAL_DIGITS = /[0-9A-Fa-f]{8}/;

function modeRule(name, verbose) {
  return `_${name}_${verbose ? "verbose" : "normal"}`;
}

function modeNode($, name, verbose) {
  return alias($[modeRule(name, verbose)], $[name]);
}

function body($, verbose) {
  return optional(field("body", modeNode($, "alternation", verbose)));
}

function classLiteralMember($, start) {
  return seq(start, optional(alias("-", $.class_character)));
}

function hexadecimalEscape($, prefix, digits) {
  return seq(
    prefix,
    field("digits", alias(token(digits), $.hexadecimal_digits)),
  );
}

function scopedFlags($, outerVerbose) {
  const branch = (enable, disable, verbose) =>
    seq(
      alias($._scoped_flags_start, "("),
      "?",
      ...(enable === null ? [] : [field("enable", alias(enable, $.flag_set))]),
      ...(disable === null
        ? []
        : ["-", field("disable", alias(disable, $.flag_set))]),
      ":",
      body($, verbose),
      ")",
    );
  return choice(
    branch($._enable_flags_with_x, null, true),
    branch($._enable_flags_without_x, null, outerVerbose),
    branch($._enable_flags_with_x, $._disable_flags_with_x, outerVerbose),
    branch($._enable_flags_with_x, $._disable_flags_without_x, true),
    branch($._enable_flags_without_x, $._disable_flags_with_x, false),
    branch($._enable_flags_without_x, $._disable_flags_without_x, outerVerbose),
    branch(null, $._disable_flags_with_x, false),
    branch(null, $._disable_flags_without_x, outerVerbose),
  );
}

function modeRules(verbose) {
  const rule = (name) => modeRule(name, verbose);
  const concreteGroups = [
    ["capturing_group"],
    ["non_capturing_group", "?", ":"],
    ["positive_lookahead_assertion", "?", "="],
    ["negative_lookahead_assertion", "?", "!"],
    ["positive_lookbehind_assertion", "?", "<="],
    ["negative_lookbehind_assertion", "?", "<!"],
    ["atomic_group", "?", ">"],
  ];
  return {
    [rule("root_alternation")]: ($) =>
      alternation(
        alias($[rule("root_concatenation")], $.concatenation),
        modeNode($, "concatenation", verbose),
      ),
    [rule("root_concatenation")]: ($) =>
      seq($[rule("term")], repeat(choice($[rule("term")], $[rule("layout")]))),
    [rule("alternation")]: ($) =>
      alternation(modeNode($, "concatenation", verbose)),
    [rule("concatenation")]: ($) =>
      repeat1(choice($[rule("term")], $[rule("layout")])),
    [rule("term")]: ($) =>
      choice($[rule("atom")], modeNode($, "repetition", verbose)),
    [rule("repetition")]: ($) =>
      seq(
        field("operand", $[rule("quantifiable_atom")]),
        repeat($[rule("layout")]),
        field("quantifier", $.quantifier),
      ),
    [rule("atom")]: ($) =>
      choice($[rule("quantifiable_atom")], $._non_quantifiable_atom),
    [rule("quantifiable_atom")]: ($) =>
      choice(
        alias($[rule("literal_character")], $.literal_character),
        $.wildcard,
        $.literal_escape,
        $.control_escape,
        $.hex_escape,
        $.unicode_escape,
        $.named_unicode_escape,
        $.character_class_escape,
        alias($._outside_octal_escape, $.octal_escape),
        alias($._outside_numeric_backreference, $.numeric_backreference),
        $.character_class,
        ...concreteGroups.map(([name]) => modeNode($, name, verbose)),
        modeNode($, "named_capturing_group", verbose),
        $.named_backreference,
        modeNode($, "conditional_group", verbose),
        modeNode($, "scoped_flags_group", verbose),
      ),
    ...Object.fromEntries(
      concreteGroups.map(([name, ...introducer]) => [
        rule(name),
        ($) => seq("(", ...introducer, body($, verbose), ")"),
      ]),
    ),
    [rule("named_capturing_group")]: ($) =>
      seq(
        "(",
        "?P",
        "<",
        field("name", alias($._angle_group_name, $.group_name)),
        ">",
        body($, verbose),
        ")",
      ),
    [rule("conditional_group")]: ($) =>
      seq(
        "(",
        "?",
        "(",
        field(
          "condition",
          choice(
            alias($._conditional_group_id, $.group_id),
            alias($._parenthesized_group_name, $.group_name),
          ),
        ),
        ")",
        optional(field("yes_pattern", modeNode($, "concatenation", verbose))),
        optional(
          seq(
            "|",
            optional(
              field("no_pattern", modeNode($, "concatenation", verbose)),
            ),
          ),
        ),
        ")",
      ),
    [rule("scoped_flags_group")]: ($) => scopedFlags($, verbose),
    [rule("layout")]: ($) =>
      verbose
        ? choice($.comment_group, $.verbose_whitespace, $.verbose_comment)
        : $.comment_group,
  };
}

function defineGrammar(name, { verbose = false } = {}) {
  return grammar({
    name,
    externals: ($) => [
      $._global_flags_start,
      $._scoped_flags_start,
      $._enable_flags_with_x,
      $._enable_flags_without_x,
      $._disable_flags_with_x,
      $._disable_flags_without_x,
      $._angle_group_name,
      $._parenthesized_group_name,
      $._conditional_group_id,
      $._comment_group_content,
      $._verbose_whitespace,
      $._verbose_comment,
      $._literal_escape,
      $._hex_escape_start,
      $._unicode_escape_short_start,
      $._unicode_escape_long_start,
      $._named_unicode_escape_start,
      $._unicode_character_name,
      $._outside_numeric_escape_start,
      $._class_start,
      $._class_numeric_escape_start,
      $._class_negation,
      $._class_leading_close,
      $._class_close,
      $._class_character,
      $._quantifier_star,
      $._quantifier_plus,
      $._quantifier_question,
      $._quantifier_lazy_suffix,
      $._quantifier_possessive_suffix,
      $._open_brace,
      $._literal_character_normal,
      $._literal_character_verbose,
    ],
    conflicts: ($) => [
      [$._atom_normal, $._repetition_normal],
      [$._atom_verbose, $._repetition_verbose],
    ],
    extras: () => [],
    rules: {
      pattern: ($) =>
        verbose
          ? seq(
              optional($._root_prefix_verbose),
              optional(
                field(
                  "body",
                  alias($._root_alternation_verbose, $.alternation),
                ),
              ),
            )
          : seq(
              optional($._root_prefix_normal),
              choice(
                optional(
                  field(
                    "body",
                    alias($._root_alternation_normal, $.alternation),
                  ),
                ),
                seq(
                  alias($._global_flags_with_x, $.global_flags),
                  optional($._root_prefix_verbose),
                  optional(
                    field(
                      "body",
                      alias($._root_alternation_verbose, $.alternation),
                    ),
                  ),
                ),
              ),
            ),
      _root_prefix_normal: ($) =>
        repeat1(
          choice(
            $.comment_group,
            alias($._global_flags_without_x, $.global_flags),
          ),
        ),
      _root_prefix_verbose: ($) =>
        repeat1(
          choice(
            $._layout_verbose,
            alias($._global_flags_without_x, $.global_flags),
            alias($._global_flags_with_x, $.global_flags),
          ),
        ),
      ...modeRules(false),
      ...modeRules(true),
      _non_quantifiable_atom: ($) =>
        choice(
          $.start_anchor,
          $.end_anchor,
          $.anchor_escape,
          $.word_boundary_escape,
        ),
      wildcard: () => ".",
      start_anchor: () => "^",
      end_anchor: () => "$",
      literal_escape: ($) => $._literal_escape,
      control_escape: () =>
        token(choice("\\a", "\\f", "\\n", "\\r", "\\t", "\\v")),
      hex_escape: ($) =>
        hexadecimalEscape(
          $,
          alias($._hex_escape_start, "\\x"),
          TWO_HEXADECIMAL_DIGITS,
        ),
      unicode_escape: ($) =>
        choice(
          hexadecimalEscape(
            $,
            alias($._unicode_escape_short_start, "\\u"),
            FOUR_HEXADECIMAL_DIGITS,
          ),
          hexadecimalEscape(
            $,
            alias($._unicode_escape_long_start, "\\U"),
            EIGHT_HEXADECIMAL_DIGITS,
          ),
        ),
      named_unicode_escape: ($) =>
        seq(
          alias($._named_unicode_escape_start, "\\N"),
          "{",
          field(
            "name",
            alias($._unicode_character_name, $.unicode_character_name),
          ),
          "}",
        ),
      character_class_escape: () => /\\[dDsSwW]/,
      anchor_escape: () => token(choice("\\A", "\\z", "\\Z")),
      word_boundary_escape: () => token(choice("\\b", "\\B")),
      _outside_octal_escape: ($) =>
        seq(
          alias($._outside_numeric_escape_start, "\\"),
          field(
            "digits",
            alias(token(/0[0-7]{0,2}|[1-7][0-7]{2}/), $.octal_digits),
          ),
        ),
      _outside_numeric_backreference: ($) =>
        seq(
          alias($._outside_numeric_escape_start, "\\"),
          field("group", alias(token(/[1-9][0-9]?/), $.group_id)),
        ),
      character_class: ($) =>
        seq(
          alias($._class_start, "["),
          optional(alias($._class_negation, "^")),
          $._class_body,
          alias($._class_close, "]"),
        ),
      _class_body: ($) =>
        choice(
          seq($._class_leading_member, repeat($._class_member)),
          repeat1($._class_member),
        ),
      _class_leading_member: ($) =>
        choice(
          alias($._leading_class_range, $.class_range),
          classLiteralMember(
            $,
            alias($._class_leading_close, $.class_character),
          ),
        ),
      _leading_class_range: ($) =>
        prec(
          1,
          classRange(
            alias($._class_leading_close, $.class_character),
            $._class_range_endpoint,
          ),
        ),
      _class_member: ($) =>
        choice(
          $.class_range,
          classLiteralMember($, $._class_range_endpoint),
          $.character_class_escape,
        ),
      class_range: ($) =>
        prec(1, classRange($._class_range_endpoint, $._class_range_endpoint)),
      _class_range_endpoint: ($) =>
        choice(
          $.class_character,
          alias("-", $.class_character),
          $.literal_escape,
          $.control_escape,
          $.backspace_escape,
          $.hex_escape,
          $.unicode_escape,
          $.named_unicode_escape,
          alias($._class_octal_escape, $.octal_escape),
        ),
      class_character: ($) => $._class_character,
      backspace_escape: () => "\\b",
      _class_octal_escape: ($) =>
        seq(
          alias($._class_numeric_escape_start, "\\"),
          field("digits", alias(token(/[0-7]{1,3}/), $.octal_digits)),
        ),
      quantifier: ($) =>
        seq(
          choice(
            alias($._quantifier_star, "*"),
            alias($._quantifier_plus, "+"),
            alias($._quantifier_question, "?"),
            seq(
              alias($._open_brace, "{"),
              field("count", $.decimal_digits),
              "}",
            ),
            seq(
              alias($._open_brace, "{"),
              optional(field("minimum", $.decimal_digits)),
              ",",
              optional(field("maximum", $.decimal_digits)),
              "}",
            ),
          ),
          optional(
            choice(
              alias($._quantifier_lazy_suffix, "?"),
              alias($._quantifier_possessive_suffix, "+"),
            ),
          ),
        ),
      decimal_digits: () => /[0-9]+/,
      named_backreference: ($) =>
        seq(
          "(",
          "?P",
          "=",
          field("name", alias($._parenthesized_group_name, $.group_name)),
          ")",
        ),
      _global_flags_with_x: ($) =>
        seq(
          alias($._global_flags_start, "("),
          "?",
          field("flags", alias($._enable_flags_with_x, $.flag_set)),
          ")",
        ),
      _global_flags_without_x: ($) =>
        seq(
          alias($._global_flags_start, "("),
          "?",
          field("flags", alias($._enable_flags_without_x, $.flag_set)),
          ")",
        ),
      comment_group: ($) =>
        seq(
          "(",
          "?",
          "#",
          optional(alias($._comment_group_content, "comment_content")),
          ")",
        ),
      verbose_whitespace: ($) => $._verbose_whitespace,
      verbose_comment: ($) => $._verbose_comment,
    },
  });
}

export default defineGrammar;
