function alternation(first, alternative) {
  return choice(first, seq(optional(first), repeat1(alternative)));
}

function leftSequence(previous, first, following = first) {
  return choice(first, seq(previous, following));
}

function classRange(start, end) {
  return seq(field("start", start), "-", field("end", end));
}

function modeRule(name, verbose) {
  return `_${name}_${verbose ? "verbose" : "normal"}`;
}

function modeNode($, name, verbose) {
  return alias($[modeRule(name, verbose)], $[name]);
}

function body($, verbose, name = "alternation") {
  return optional(
    field("body", alias($[modeRule(name, verbose)], $.alternation)),
  );
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
  return seq(prefix, field("digits", alias(digits, kind)));
}

function hexadecimalEscape($, prefix, count) {
  return digitsEscape(
    prefix,
    new RegExp(`[0-9A-Fa-f]{${count}}`),
    $.hexadecimal_digits,
  );
}

function textUnit(excluded) {
  return choice(
    new RegExp(`[^\\\\${excluded}]`),
    prec(1, "\0"),
    seq("\\", choice(/./, "\n", prec(1, "\0"))),
  );
}

function globalFlags($, flags) {
  return seq("(", "?", field("flags", alias(flags, $.flag_set)), ")");
}

function scopedFlags($, outerVerbose) {
  const none = { flags: null, x: false };
  const enables = [
    { flags: $._enable_flags_with_x, x: true },
    { flags: $._enable_flags_without_x, x: false },
  ];
  const disables = [
    { flags: $._disable_flags_with_x, x: true },
    { flags: $._disable_flags_without_x, x: false },
  ];
  const branch = (enable, disable) =>
    seq(
      "(",
      "?",
      ...(enable.flags
        ? [field("enable", alias(enable.flags, $.flag_set))]
        : []),
      ...(disable.flags
        ? ["-", field("disable", alias(disable.flags, $.flag_set))]
        : []),
      ":",
      body($, enable.x === disable.x ? outerVerbose : enable.x),
      ")",
    );
  return choice(
    ...enables.map((enable) => branch(enable, none)),
    ...enables.flatMap((enable) =>
      disables.map((disable) => branch(enable, disable)),
    ),
    ...disables.map((disable) => branch(none, disable)),
  );
}

function rootRules(verbose) {
  const rule = (name) => modeRule(name, verbose);
  return {
    [rule("root_prefix")]: ($) =>
      repeat1(
        choice(
          verbose ? $._layout_verbose : $.comment_group,
          alias($._global_flags_without_x, $.global_flags),
          ...(verbose ? [alias($._global_flags_with_x, $.global_flags)] : []),
        ),
      ),
    [rule("root_alternation")]: ($) =>
      alternation(
        alias($[rule("root_concatenation")], $.concatenation),
        $[rule("alternative")],
      ),
    [rule("root_concatenation")]: ($) =>
      leftSequence(
        $[rule("root_concatenation")],
        $[rule("term")],
        choice($[rule("term")], $[rule("layout")]),
      ),
  };
}

function modeRules(verbose) {
  const rule = (name) => modeRule(name, verbose);
  const simpleGroups = [
    ["capturing_group"],
    ["non_capturing_group", "?", ":"],
    ["positive_lookahead_assertion", "?", "="],
    ["negative_lookahead_assertion", "?", "!"],
    ["positive_lookbehind_assertion", "?", "<="],
    ["negative_lookbehind_assertion", "?", "<!"],
    ["atomic_group", "?", ">"],
  ];
  return {
    [rule("alternation")]: ($) =>
      alternation(
        modeNode($, "concatenation", verbose),
        $[rule("alternative")],
      ),
    // Resumed balancing after a progress cancel can misplace aliases inside a
    // multi-symbol repeat element, so repeat this single rule instead.
    [rule("alternative")]: ($) =>
      seq("|", optional(modeNode($, "concatenation", verbose))),
    [rule("concatenation")]: ($) =>
      leftSequence(
        $[rule("concatenation")],
        choice($[rule("term")], $[rule("layout")]),
      ),
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
    [rule("literal_character")]: ($) =>
      choice(
        verbose ? /[^.^$\\()\x5b*+?|{# \t\r\n\v\f]/ : /[^.^$\\()\x5b*+?|{]/,
        $._nul_character,
        $._literal_open_brace,
      ),
    [rule("quantifiable_atom")]: ($) =>
      choice(
        alias($[rule("literal_character")], $.literal_character),
        $.wildcard,
        $._literal_escape,
        $.control_escape,
        $.hex_escape,
        $.unicode_escape,
        $.named_unicode_escape,
        $.character_class_escape,
        alias($._outside_octal_escape, $.octal_escape),
        alias($._outside_numeric_backreference, $.numeric_backreference),
        $.character_class,
        ...simpleGroups.map(([name]) => modeNode($, name, verbose)),
        modeNode($, "named_capturing_group", verbose),
        $.named_backreference,
        modeNode($, "conditional_group", verbose),
        modeNode($, "scoped_flags_group", verbose),
      ),
    ...Object.fromEntries(
      simpleGroups.map(([name, ...introducer]) => [
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
            alias($._conditional_group_name, $.group_name),
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
      $._open_brace,
      $._literal_open_brace,
      $._nul_character,
      $._escaped_nul_character,
      $._numeric_escape_start,
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
              body($, true, "root_alternation"),
            )
          : seq(
              optional($._root_prefix_normal),
              choice(
                body($, false, "root_alternation"),
                seq(
                  alias($._global_flags_with_x, $.global_flags),
                  optional($._root_prefix_verbose),
                  body($, true, "root_alternation"),
                ),
              ),
            ),
      ...(!verbose ? rootRules(false) : {}),
      ...rootRules(true),
      ...modeRules(false),
      ...modeRules(true),
      _non_quantifiable_atom: ($) =>
        choice(
          alias("^", $.start_anchor),
          $.end_anchor,
          $.anchor_escape,
          $.word_boundary_escape,
        ),
      wildcard: () => ".",
      end_anchor: () => "$",
      _literal_escape: ($) =>
        choice(
          alias(/\\[^A-Za-z0-9]/, $.literal_escape),
          alias($._escaped_nul_character, $.literal_escape),
        ),
      control_escape: () =>
        token(choice("\\a", "\\f", "\\n", "\\r", "\\t", "\\v")),
      hex_escape: ($) => hexadecimalEscape($, "\\x", 2),
      unicode_escape: ($) =>
        choice(
          hexadecimalEscape($, "\\u", 4),
          digitsEscape(
            "\\U",
            /00(0[0-9A-Fa-f]|10)[0-9A-Fa-f]{4}/,
            $.hexadecimal_digits,
          ),
        ),
      named_unicode_escape: ($) =>
        seq(
          "\\N",
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
          field("group", alias(/[1-9][0-9]?/, $.group_id)),
        ),
      character_class: ($) => seq("[", optional("^"), $._class_body, "]"),
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
          $._literal_escape,
          $.control_escape,
          $.backspace_escape,
          $.hex_escape,
          $.unicode_escape,
          $.named_unicode_escape,
          alias($._class_octal_escape, $.octal_escape),
        ),
      class_character: () => token(choice(/[^\\\]-]/, prec(1, "\0"))),
      backspace_escape: () => "\\b",
      _class_octal_escape: ($) =>
        digitsEscape(
          alias($._numeric_escape_start, "\\"),
          /[0-7]{1,3}/,
          $.octal_digits,
        ),
      quantifier: ($) =>
        seq(
          choice(
            "*",
            "+",
            "?",
            seq(
              alias($._open_brace, "{"),
              choice(
                field("count", $.decimal_digits),
                seq(
                  optional(field("minimum", $.decimal_digits)),
                  ",",
                  optional(field("maximum", $.decimal_digits)),
                ),
              ),
              "}",
            ),
          ),
          optional(choice("?", "+")),
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
      _enable_flags_with_x: () => /[aiLmsu]*x[aiLmsux]*/,
      _enable_flags_without_x: () => /[aiLmsu]+/,
      _disable_flags_with_x: () => /[ims]*x[imsx]*/,
      _disable_flags_without_x: () => /[ims]+/,
      _angle_group_name: () => token(repeat1(textUnit(">"))),
      _parenthesized_group_name: () => token(repeat1(textUnit(")"))),
      _conditional_group_id: () => /[0-9]+/,
      _conditional_group_name: () =>
        token(seq(repeat(/[0-9]/), textUnit("0-9)"), repeat(textUnit(")")))),
      _unicode_character_name: () => token(repeat1(textUnit("}"))),
      comment_group: ($) =>
        seq(
          "(",
          "?",
          "#",
          optional(alias($._comment_group_content, $.comment_content)),
          ")",
        ),
      verbose_whitespace: () => /[ \t\n\v\f\r]+/,
      _comment_group_content: () => token(repeat1(textUnit(")"))),
      verbose_comment: () => token(seq("#", repeat(textUnit("\n")))),
    },
  });
}
