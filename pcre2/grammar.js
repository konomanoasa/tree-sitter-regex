import { unicodeDecimalDigit, unicodeLetter } from "./unicode.js";

const groupName = new RegExp(
  `(?:_|${unicodeLetter})(?:_|${unicodeLetter}|${unicodeDecimalDigit})*`,
  "u",
);

const LOOKAROUNDS = {
  positive_lookahead_assertion: ["=", "pla", "positive_lookahead"],
  negative_lookahead_assertion: ["!", "nla", "negative_lookahead"],
  positive_lookbehind_assertion: ["<=", "plb", "positive_lookbehind"],
  negative_lookbehind_assertion: ["<!", "nlb", "negative_lookbehind"],
};

const NON_ATOMIC_LOOKAROUNDS = {
  non_atomic_lookahead_assertion: [
    "*",
    "napla",
    "non_atomic_positive_lookahead",
  ],
  non_atomic_lookbehind_assertion: [
    "<*",
    "naplb",
    "non_atomic_positive_lookbehind",
  ],
};

function body($) {
  return optional(field("body", $.alternation));
}

function group($, ...prefix) {
  return seq(
    alias($._scope_open, "("),
    ...prefix,
    body($),
    alias($._scope_close, ")"),
  );
}

function item($, ...content) {
  return seq(alias($._item_open, "("), ...content, ")");
}

function braced($, ...content) {
  return [
    "{",
    optional($._escape_space),
    ...content,
    optional($._escape_space),
    "}",
  ];
}

function reference($, open, close, target) {
  const group = field("group", target ?? choice($.group_name, $.group_number));
  return seq(...(open === "{" ? braced($, group) : [open, group, close]));
}

function classRange($, start) {
  return seq(
    field("start", start),
    repeat($._class_layout),
    "-",
    repeat($._class_layout),
    field("end", choice($._class_endpoint, alias("-", $.class_character))),
  );
}

export default grammar({
  name: "pcre2",
  externals: ($) => [
    $._scope_open,
    $._capture_open,
    $._no_capture_open,
    $._item_open,
    $._scope_close,
    $._pipe,
    $._condition_open,
    $._enable_flags,
    $._disable_flags,
    $._reset_flags,
    $.literal_character,
    $.class_character,
    $._first_class_character,
    $.verbose_whitespace,
    $._class_whitespace,
    $.verbose_comment,
    $.quote_start,
    $.quote_end,
    $._octal_prefix,
    $._decimal_prefix,
    $._hex_short_prefix,
    $._hex_brace_prefix,
    $._named_unicode_prefix,
    $._control_prefix,
    $.literal_escape,
    $.character_class_escape,
    $.control_escape,
    $.backspace_escape,
    $.anchor_escape,
    $.word_boundary_escape,
    $.match_reset,
    $._quantifier_open,
    $._property_prefix,
    $._newline_name,
    $.comment_content,
    $.verb_argument,
    $._octal_brace_prefix,
    $._class_negation,
    $._quantifier_star,
    $._quantifier_plus,
    $._quantifier_question,
    $._property_ignored,
    $._posix_open,
    $._error_sentinel,
  ],
  extras: () => [],
  conflicts: ($) => [
    [$._atom, $.repetition],
    [$._class_member, $.class_range],
    [$.quantifier],
    [$._set_expression, $.class_intersection],
    [$.class_union, $.class_intersection],
    [$.class_subtraction, $.class_intersection],
    [$.class_symmetric_difference, $.class_intersection],
  ],
  rules: {
    pattern: ($) => seq(repeat($.start_option), body($)),
    alternation: ($) =>
      choice(
        $.concatenation,
        seq(
          optional($.concatenation),
          repeat1(seq(alias($._pipe, "|"), optional($.concatenation))),
        ),
      ),
    concatenation: ($) => repeat1(choice($._atom, $.repetition, $._layout)),
    repetition: ($) =>
      seq(
        field("operand", $._quantifiable),
        repeat($._layout),
        field("quantifier", $.quantifier),
      ),
    _atom: ($) =>
      choice(
        $._quantifiable,
        $.start_anchor,
        $.end_anchor,
        $.anchor_escape,
        $.word_boundary_escape,
        $.match_reset,
        $.global_flags,
        $.callout,
        $.control_verb,
      ),
    _quantifiable: ($) =>
      choice(
        $.literal_character,
        $.wildcard,
        $._character_escape,
        $.character_class_escape,
        $.unicode_property,
        $.word_boundary_assertion,
        $.numeric_backreference,
        $.backreference,
        $.subroutine_call,
        $.character_class,
        $.extended_character_class,
        $.capturing_group,
        $.non_capturing_group,
        $.named_capturing_group,
        $.branch_reset_group,
        $.atomic_group,
        $.scoped_flags_group,
        $.positive_lookahead_assertion,
        $.negative_lookahead_assertion,
        $.positive_lookbehind_assertion,
        $.negative_lookbehind_assertion,
        $.non_atomic_lookahead_assertion,
        $.non_atomic_lookbehind_assertion,
        $.scan_substring_assertion,
        $.script_run_group,
        $.atomic_script_run_group,
        $.conditional_group,
        alias($._accept_verb, $.control_verb),
      ),
    wildcard: () => ".",
    start_anchor: () => "^",
    end_anchor: () => "$",
    word_boundary_assertion: ($) =>
      seq("[", alias($._posix_open, "["), ":", choice("<", ">"), ":", "]", "]"),
    capturing_group: ($) =>
      seq(alias($._capture_open, "("), body($), alias($._scope_close, ")")),
    non_capturing_group: ($) =>
      choice(
        seq(
          alias($._no_capture_open, "("),
          body($),
          alias($._scope_close, ")"),
        ),
        group($, "?", ":"),
      ),
    named_capturing_group: ($) =>
      choice(
        group($, choice("?", "?P"), "<", field("name", $.group_name), ">"),
        group($, "?", "'", field("name", $.group_name), "'"),
      ),
    branch_reset_group: ($) => group($, "?", "|"),
    atomic_group: ($) =>
      choice(group($, "?", ">"), group($, "*", "atomic", ":")),
    ...Object.fromEntries(
      Object.entries({ ...LOOKAROUNDS, ...NON_ATOMIC_LOOKAROUNDS }).map(
        ([rule, [symbol, ...names]]) => [
          rule,
          ($) =>
            choice(group($, "?", symbol), group($, "*", choice(...names), ":")),
        ],
      ),
    ),
    script_run_group: ($) => group($, "*", choice("sr", "script_run"), ":"),
    atomic_script_run_group: ($) =>
      group($, "*", choice("asr", "atomic_script_run"), ":"),
    scan_substring_assertion: ($) =>
      group($, "*", choice("scs", "scan_substring"), ":", $.group_list),
    group_list: ($) =>
      seq("(", $._group_list_item, repeat(seq(",", $._group_list_item)), ")"),
    _group_list_item: ($) =>
      choice(
        $.group_number,
        seq("<", $.group_name, ">"),
        seq("'", $.group_name, "'"),
      ),
    group_name: () => groupName,
    group_number: () => /[-+]?[0-9]+/,
    global_flags: ($) => item($, "?", optional($._flags)),
    scoped_flags_group: ($) => group($, "?", $._flags, ":"),
    _flags: ($) => {
      const enable = alias($._enable_flags, $.flag_set);
      const disable = seq("-", optional(alias($._disable_flags, $.flag_set)));
      return choice(
        seq(enable, optional(disable)),
        disable,
        seq(alias($._reset_flags, "^"), optional(enable)),
      );
    },
    conditional_group: ($) => {
      const condition = (content) => [
        alias($._condition_open, "("),
        content,
        alias($._scope_close, ")"),
      ];
      const yesPattern = optional(field("yes_pattern", $.concatenation));
      return seq(
        alias($._scope_open, "("),
        "?",
        choice(
          seq(...condition(field("condition", $.define_condition)), yesPattern),
          seq(
            choice(
              seq(
                ...condition(
                  choice(
                    field(
                      "condition",
                      choice(
                        $._condition_name,
                        $.group_number,
                        $.recursion_condition,
                        $.version_condition,
                        $.assertion_condition,
                      ),
                    ),
                    seq("<", field("condition", $.group_name), ">"),
                    seq("'", field("condition", $.group_name), "'"),
                  ),
                ),
              ),
              seq(
                choice(
                  seq($.callout, repeat($._layout)),
                  seq(
                    $.comment_group,
                    repeat($._layout),
                    optional(seq($.callout, repeat($._layout))),
                  ),
                ),
                ...condition(field("condition", $.assertion_condition)),
              ),
            ),
            yesPattern,
            optional(
              seq(
                alias($._pipe, "|"),
                optional(field("no_pattern", $.concatenation)),
              ),
            ),
          ),
        ),
        alias($._scope_close, ")"),
      );
    },
    _condition_name: ($) =>
      choice(
        alias("R", $.condition_name),
        alias($.group_name, $.condition_name),
      ),
    define_condition: () => "DEFINE",
    recursion_condition: ($) => seq("R", "&", field("name", $.group_name)),
    version_condition: ($) =>
      seq(
        token(prec(1, "VERSION")),
        choice("=", ">="),
        $.decimal_digits,
        optional(seq(".", $.decimal_digits)),
      ),
    assertion_condition: ($) => {
      const forms = Object.values(LOOKAROUNDS);
      return choice(
        seq("?", choice(...forms.map(([symbol]) => symbol)), body($)),
        seq(
          "*",
          choice(...forms.flatMap(([, ...names]) => names)),
          ":",
          body($),
        ),
      );
    },
    numeric_backreference: ($) =>
      seq(
        alias($._decimal_prefix, "\\"),
        field("group", alias($.decimal_digits, $.group_number)),
      ),
    backreference: ($) =>
      choice(
        seq("\\g", field("group", $.group_number)),
        seq("\\g", reference($, "{", "}")),
        seq(
          "\\k",
          choice(
            reference($, "<", ">", $.group_name),
            reference($, "'", "'", $.group_name),
            reference($, "{", "}", $.group_name),
          ),
        ),
        item($, "?P", "=", field("group", $.group_name)),
      ),
    subroutine_call: ($) =>
      choice(
        item(
          $,
          "?",
          choice("R", field("group", $.group_number)),
          optional($.group_list),
        ),
        item(
          $,
          choice(seq("?", "&"), seq("?P", ">")),
          field("group", $.group_name),
          optional($.group_list),
        ),
        seq("\\g", choice(reference($, "<", ">"), reference($, "'", "'"))),
      ),
    _character_escape: ($) =>
      choice(
        $.literal_escape,
        $.control_escape,
        $.control_character_escape,
        $.octal_escape,
        $.hex_escape,
        $.unicode_escape,
      ),
    control_character_escape: ($) =>
      seq(
        alias($._control_prefix, "\\c"),
        field("character", alias(/[ -~]/, $.control_character)),
      ),
    octal_escape: ($) =>
      choice(
        seq(
          alias($._octal_prefix, "\\"),
          field("digits", alias(/[0-7]{1,3}/, $.octal_digits)),
        ),
        seq(
          alias($._octal_brace_prefix, "\\o"),
          ...braced($, field("digits", alias(/[0-7]+/, $.octal_digits))),
        ),
      ),
    hex_escape: ($) =>
      choice(
        seq(
          alias($._hex_short_prefix, "\\x"),
          field("digits", alias(/[0-9A-Fa-f]{1,2}/, $.hexadecimal_digits)),
        ),
        seq(alias($._hex_brace_prefix, "\\x"), $._braced_hexadecimal),
      ),
    unicode_escape: ($) =>
      seq(
        alias($._named_unicode_prefix, "\\N"),
        ...braced(
          $,
          "U+",
          field("digits", alias(/[0-9A-Fa-f]+/, $.hexadecimal_digits)),
        ),
      ),
    _braced_hexadecimal: ($) =>
      seq(
        ...braced(
          $,
          field("digits", alias(/[0-9A-Fa-f]+/, $.hexadecimal_digits)),
        ),
      ),
    _escape_space: ($) => alias(/[ \t]+/, $.escape_whitespace),
    unicode_property: ($) =>
      seq(
        alias($._property_prefix, $.property_escape),
        choice(
          field("name", alias(/[A-Za-z]/, $.property_name)),
          seq(
            "{",
            optional(
              seq(
                optional(alias($._property_ignored, $.property_ignored)),
                "^",
              ),
            ),
            field(
              "name",
              alias(/[A-Za-z0-9_:= \t\n\v\f\r&-]+/, $.property_name),
            ),
            "}",
          ),
        ),
      ),
    quantifier: ($) =>
      seq(
        choice(
          alias($._quantifier_star, "*"),
          alias($._quantifier_plus, "+"),
          alias($._quantifier_question, "?"),
          seq(
            alias($._quantifier_open, "{"),
            optional($._quantifier_space),
            choice(
              field("count", $.decimal_digits),
              seq(
                optional(field("minimum", $.decimal_digits)),
                optional($._quantifier_space),
                ",",
                optional($._quantifier_space),
                optional(field("maximum", $.decimal_digits)),
              ),
            ),
            optional($._quantifier_space),
            "}",
          ),
        ),
        optional(
          seq(
            repeat($._layout),
            choice(
              alias($._quantifier_question, "?"),
              alias($._quantifier_plus, "+"),
            ),
          ),
        ),
      ),
    _quantifier_space: ($) => alias(/[ \t]+/, $.quantifier_whitespace),
    decimal_digits: () => /[0-9]+/,
    character_class: ($) =>
      seq(
        "[",
        repeat($._class_layout),
        optional(seq(alias($._class_negation, "^"), repeat($._class_layout))),
        $._class_members,
        "]",
      ),
    _class_members: ($) =>
      choice(
        seq(
          choice(
            $._class_member,
            alias($._first_class_character, $.class_character),
          ),
          repeat($._class_layout),
          optional($._class_following),
        ),
        seq(
          choice(
            $.class_range,
            alias($._class_range_from_first, $.class_range),
          ),
          repeat($._class_layout),
          optional($._class_after_range),
        ),
      ),
    _class_following: ($) =>
      choice(
        seq(
          $._class_member,
          repeat($._class_layout),
          optional($._class_following),
        ),
        seq(
          $.class_range,
          repeat($._class_layout),
          optional($._class_after_range),
        ),
        seq(alias("-", $.class_character), repeat($._class_layout)),
      ),
    _class_after_range: ($) =>
      choice(
        $._class_following,
        seq(
          alias("-", $.class_character),
          repeat($._class_layout),
          $._class_following,
        ),
        seq(
          alias($._class_range_from_hyphen, $.class_range),
          repeat($._class_layout),
          optional($._class_after_range),
        ),
      ),
    _class_member: ($) =>
      choice(
        $._class_endpoint,
        $.character_class_escape,
        $.unicode_property,
        $.posix_character_class,
      ),
    _class_endpoint: ($) =>
      choice($.class_character, $._character_escape, $.backspace_escape),
    class_range: ($) => classRange($, $._class_endpoint),
    _class_range_from_first: ($) =>
      classRange($, alias($._first_class_character, $.class_character)),
    _class_range_from_hyphen: ($) =>
      classRange($, alias("-", $.class_character)),
    posix_character_class: ($) =>
      seq(
        alias($._posix_open, "["),
        ":",
        optional("^"),
        field(
          "name",
          alias(
            choice(
              "alnum",
              "alpha",
              "ascii",
              "blank",
              "cntrl",
              "digit",
              "graph",
              "lower",
              "print",
              "punct",
              "space",
              "upper",
              "word",
              "xdigit",
            ),
            $.class_name,
          ),
        ),
        ":",
        "]",
      ),
    extended_character_class: ($) =>
      seq(
        alias($._scope_open, "("),
        "?",
        "[",
        repeat($._class_layout),
        field("expression", $._set_expression),
        repeat($._class_layout),
        "]",
        alias($._scope_close, ")"),
      ),
    _set_expression: ($) =>
      choice(
        $._set_intersection,
        $.class_union,
        $.class_subtraction,
        $.class_symmetric_difference,
      ),
    _set_intersection: ($) => choice($._set_unary, $.class_intersection),
    _set_unary: ($) => choice($._set_operand, $.class_complement),
    _set_operand: ($) =>
      choice(
        $.character_class,
        $.posix_character_class,
        $._character_escape,
        $.backspace_escape,
        $.character_class_escape,
        $.unicode_property,
        $.class_parenthesized_expression,
      ),
    class_parenthesized_expression: ($) =>
      seq(
        "(",
        repeat($._class_layout),
        $._set_expression,
        repeat($._class_layout),
        ")",
      ),
    class_complement: ($) =>
      seq("!", repeat($._class_layout), field("operand", $._set_unary)),
    ...Object.fromEntries(
      [
        { rule: "class_intersection", operator: "&", precedence: 2 },
        { rule: "class_union", operator: choice("|", "+"), precedence: 1 },
        { rule: "class_subtraction", operator: "-", precedence: 1 },
        { rule: "class_symmetric_difference", operator: "^", precedence: 1 },
      ].map(({ rule, operator, precedence }) => [
        rule,
        ($) =>
          seq(
            field(
              "left",
              precedence === 2 ? $._set_intersection : $._set_expression,
            ),
            repeat($._class_layout),
            operator,
            repeat($._class_layout),
            field(
              "right",
              precedence === 2 ? $._set_unary : $._set_intersection,
            ),
          ),
      ]),
    ),
    _class_layout: ($) =>
      choice(
        alias($._class_whitespace, $.verbose_whitespace),
        $.quote_start,
        $.quote_end,
      ),
    _layout: ($) =>
      choice(
        $.verbose_whitespace,
        $.verbose_comment,
        $.comment_group,
        $.quote_start,
        $.quote_end,
      ),
    comment_group: ($) => item($, "?", "#", optional($.comment_content)),
    callout: ($) =>
      item(
        $,
        "?C",
        optional(choice(field("number", $.decimal_digits), $.callout_string)),
      ),
    callout_string: ($) =>
      choice(
        ...["`", "'", '"', "^", "%", "#", "$", "{"].map((open) => {
          const close = open === "{" ? "}" : open;
          return seq(
            open,
            optional(
              field(
                "content",
                alias(
                  token(
                    repeat1(
                      choice(
                        new RegExp(`[^${close}]`),
                        close + close,
                        prec(1, "\0"),
                      ),
                    ),
                  ),
                  $.callout_content,
                ),
              ),
            ),
            close,
          );
        }),
      ),
    control_verb: ($) =>
      item(
        $,
        "*",
        choice(
          seq(
            field(
              "name",
              alias(
                choice("FAIL", "F", "COMMIT", "PRUNE", "SKIP", "THEN"),
                $.verb_name,
              ),
            ),
            optional(seq(":", optional($.verb_argument))),
          ),
          seq(
            optional(field("name", alias("MARK", $.verb_name))),
            ":",
            $.verb_argument,
          ),
        ),
      ),
    _accept_verb: ($) =>
      item(
        $,
        "*",
        field("name", alias("ACCEPT", $.verb_name)),
        optional(seq(":", optional($.verb_argument))),
      ),
    start_option: ($) =>
      item(
        $,
        "*",
        choice(
          field("name", alias($._newline_name, $.option_name)),
          field(
            "name",
            alias(
              choice(
                "UTF",
                "UTF8",
                "UCP",
                "NOTEMPTY",
                "NOTEMPTY_ATSTART",
                "NO_AUTO_POSSESS",
                "NO_DOTSTAR_ANCHOR",
                "NO_JIT",
                "NO_START_OPT",
                "CASELESS_RESTRICT",
                "TURKISH_CASING",
                "BSR_ANYCRLF",
                "BSR_UNICODE",
              ),
              $.option_name,
            ),
          ),
          seq(
            field(
              "name",
              alias(
                choice(
                  "LIMIT_DEPTH",
                  "LIMIT_RECURSION",
                  "LIMIT_HEAP",
                  "LIMIT_MATCH",
                ),
                $.option_name,
              ),
            ),
            "=",
            field("value", $.decimal_digits),
          ),
        ),
      ),
  },
});
