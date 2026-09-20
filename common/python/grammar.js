function alternation(first, following = first) {
  return choice(
    first,
    seq(optional(first), repeat1(seq("|", optional(following)))),
  );
}

function classRange(start, end) {
  return seq(field("start", start), "-", field("end", end));
}

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

function classMembers($, starts, ranges) {
  const member = choice(starts, $.character_class_escape);
  return choice(
    seq(member, optional($._class_members_after_member)),
    seq(ranges, optional($._class_members_after_range)),
    seq(member, alias("-", $.class_character)),
  );
}

function digitsEscape(prefix, digits, kind) {
  return seq(prefix, field("digits", alias(token(digits), kind)));
}

function globalFlags($, flags) {
  return seq(
    alias($._global_flags_start, "("),
    "?",
    field("flags", alias(flags, $.flag_set)),
    ")",
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

export default function defineGrammar(name, mode) {
  const verbose = mode === "verbose";
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
      $._verbose_comment,
      $._literal_escape,
      $._hex_escape_start,
      $._unicode_escape_short_start,
      $._unicode_escape_long_start,
      $._named_unicode_escape_start,
      $._unicode_character_name,
      $._numeric_escape_start,
      $._class_negation,
      $._class_character,
      $._open_brace,
      $._quantifier_question,
      $._quantifier_lazy_suffix,
      $._literal_character_normal,
      $._literal_character_verbose,
      $._error_sentinel,
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
        digitsEscape(
          alias($._hex_escape_start, "\\x"),
          TWO_HEXADECIMAL_DIGITS,
          $.hexadecimal_digits,
        ),
      unicode_escape: ($) =>
        choice(
          digitsEscape(
            alias($._unicode_escape_short_start, "\\u"),
            FOUR_HEXADECIMAL_DIGITS,
            $.hexadecimal_digits,
          ),
          digitsEscape(
            alias($._unicode_escape_long_start, "\\U"),
            EIGHT_HEXADECIMAL_DIGITS,
            $.hexadecimal_digits,
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
        digitsEscape(
          alias($._numeric_escape_start, "\\"),
          /0[0-7]{0,2}|[1-7][0-7]{2}/,
          $.octal_digits,
        ),
      _outside_numeric_backreference: ($) =>
        seq(
          alias($._numeric_escape_start, "\\"),
          field("group", alias(token(/[1-9][0-9]?/), $.group_id)),
        ),
      character_class: ($) =>
        seq("[", optional(alias($._class_negation, "^")), $._class_body, "]"),
      // A hyphen after a member is a range operator, or a literal only when
      // "]" follows; a fresh hyphen member exists only first or after a range.
      _class_body: ($) =>
        classMembers(
          $,
          choice(
            alias("]", $.class_character),
            alias("-", $.class_character),
            $._class_endpoint,
          ),
          choice(
            alias($._class_range_from_leading_close, $.class_range),
            alias($._class_range_from_hyphen, $.class_range),
            $.class_range,
          ),
        ),
      _class_members_after_range: ($) =>
        classMembers(
          $,
          choice(alias("-", $.class_character), $._class_endpoint),
          choice(
            alias($._class_range_from_hyphen, $.class_range),
            $.class_range,
          ),
        ),
      _class_members_after_member: ($) =>
        classMembers($, $._class_endpoint, $.class_range),
      class_range: ($) => classRange($._class_endpoint, $._class_range_end),
      _class_range_from_hyphen: ($) =>
        classRange(alias("-", $.class_character), $._class_range_end),
      _class_range_from_leading_close: ($) =>
        classRange(alias("]", $.class_character), $._class_range_end),
      _class_range_end: ($) =>
        choice($._class_endpoint, alias("-", $.class_character)),
      _class_endpoint: ($) =>
        choice(
          $.class_character,
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
        digitsEscape(
          alias($._numeric_escape_start, "\\"),
          /[0-7]{1,3}/,
          $.octal_digits,
        ),
      // "?" stays external: the shared lexer would extend it to "?P".
      quantifier: ($) =>
        seq(
          choice(
            "*",
            "+",
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
          optional(choice(alias($._quantifier_lazy_suffix, "?"), "+")),
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
      _global_flags_with_x: ($) => globalFlags($, $._enable_flags_with_x),
      _global_flags_without_x: ($) => globalFlags($, $._enable_flags_without_x),
      comment_group: ($) =>
        seq(
          "(",
          "?",
          "#",
          optional(alias($._comment_group_content, $.comment_content)),
          ")",
        ),
      verbose_whitespace: () => /[ \t\n\v\f\r]+/,
      verbose_comment: ($) => $._verbose_comment,
    },
  });
}
