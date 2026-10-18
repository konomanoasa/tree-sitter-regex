const BRACKET_CHARACTER = /[^\x5b]/;
const COLLATING_ELEMENT_SINGLE = /[^\]\x5b-]/;
const CLASS_NAME = /[A-Za-z][A-Za-z0-9]*/;
const DUPLICATION_COUNT = /[0-9]+/;

const ERE_ORDINARY_CHARACTER = /[^^.\x5b$()|*+?{\\]/;
const ERE_QUOTED_CHARACTER = /\\[.\x5b\]$()|*+?{}\\^]/;
const BRE_ORDINARY_CHARACTER = /[^.\x5b*\\]/;
const BRE_LEADING_ORDINARY_CHARACTER = /[^.\x5b\\]/;
const BRE_QUOTED_CHARACTER = /\\[.*\x5b\]$|+?\\^]/;
const BACKREFERENCE = /\\[1-9]/;

function leading($, name) {
  return alias($[`_leading_${name}`], $[name]);
}

// Negated classes exclude NUL.
function nul($, name) {
  return alias("\0", $[name]);
}

function oneCharOrCollElem($, ...ordinary) {
  return choice(
    ...ordinary,
    nul($, "ordinary_character"),
    $.quoted_character,
    ".",
    $.bracket_expression,
  );
}

function leftSequence(previous, first, following = first) {
  return choice(first, seq(previous, following));
}

function rightAnchor($) {
  return alias($._bre_right_anchor, "$");
}

function interval($, opening, closing) {
  return seq(
    opening,
    field("minimum", $.duplication_count),
    optional(seq(",", optional(field("maximum", $.duplication_count)))),
    closing,
  );
}

function breRules() {
  return {
    basic_reg_exp: ($) => $.bre_branch,
    // Separate anchor-only branches so ^ binds to the following operand.
    bre_branch: ($) =>
      choice(
        alias($._bre_anchor_only_expression, $.bre_expression),
        $._bre_sequence,
      ),
    _bre_sequence: ($) =>
      leftSequence(
        $._bre_sequence,
        leading($, "bre_expression"),
        $.bre_expression,
      ),
    _bre_anchor_only_expression: ($) => seq("^", optional(rightAnchor($))),
    _leading_bre_expression: ($) =>
      prec.right(
        choice(
          seq(
            optional("^"),
            leading($, "simple_bre"),
            optional(rightAnchor($)),
          ),
          rightAnchor($),
        ),
      ),
    bre_expression: ($) =>
      prec.right(
        choice(seq($.simple_bre, optional(rightAnchor($))), rightAnchor($)),
      ),
    _nested_basic_reg_exp: ($) => alias($._nested_bre_branch, $.bre_branch),
    _nested_bre_branch: ($) =>
      seq(
        alias($._nested_leading_bre_expression, $.bre_expression),
        optional($._nested_bre_tail),
      ),
    _nested_bre_tail: ($) =>
      leftSequence(
        $._nested_bre_tail,
        alias($._nested_bre_expression, $.bre_expression),
      ),
    _nested_leading_bre_expression: ($) => leading($, "simple_bre"),
    _nested_bre_expression: ($) => $.simple_bre,
    _leading_simple_bre: ($) =>
      seq(leading($, "nondupl_bre"), optional($.bre_dupl_symbol)),
    simple_bre: ($) => seq($.nondupl_bre, optional($.bre_dupl_symbol)),
    _leading_nondupl_bre: ($) =>
      choice(
        leading($, "one_char_or_coll_elem_bre"),
        $._bre_subexpression,
        $.backreference,
      ),
    nondupl_bre: ($) =>
      choice(
        $.one_char_or_coll_elem_bre,
        $._bre_subexpression,
        $.backreference,
      ),
    _bre_subexpression: ($) =>
      seq(
        field("opening", "\\("),
        optional(
          field("expression", alias($._nested_basic_reg_exp, $.basic_reg_exp)),
        ),
        field("closing", "\\)"),
      ),
    _leading_one_char_or_coll_elem_bre: ($) =>
      oneCharOrCollElem(
        $,
        alias($._bre_leading_ordinary_character, $.ordinary_character),
      ),
    one_char_or_coll_elem_bre: ($) =>
      oneCharOrCollElem($, $.ordinary_character),
    bre_dupl_symbol: ($) => choice("*", interval($, "\\{", "\\}")),
    backreference: () => BACKREFERENCE,
    ordinary_character: () => BRE_ORDINARY_CHARACTER,
    quoted_character: () => BRE_QUOTED_CHARACTER,
    _bre_leading_ordinary_character: () => BRE_LEADING_ORDINARY_CHARACTER,
  };
}

function ereLevelRules(nested) {
  const name = (rule) => (nested ? `_nested_${rule}` : rule);
  const sequence = nested ? "_nested_ere_sequence" : "_ere_sequence";
  const reference = ($, rule) =>
    nested ? alias($[name(rule)], $[rule]) : $[rule];
  return {
    [name("extended_reg_exp")]: ($) =>
      seq(
        reference($, "ere_branch"),
        repeat(seq("|", reference($, "ere_branch"))),
      ),
    [name("ere_branch")]: ($) => $[sequence],
    [sequence]: ($) =>
      leftSequence($[sequence], reference($, "ere_expression")),
    [name("ere_expression")]: ($) =>
      seq(
        choice(
          reference($, "one_char_or_coll_elem_ere"),
          "^",
          "$",
          seq(
            field("opening", "("),
            optional(
              field(
                "expression",
                alias($._nested_extended_reg_exp, $.extended_reg_exp),
              ),
            ),
            field("closing", ")"),
          ),
        ),
        repeat($.ere_dupl_symbol),
      ),
    [name("one_char_or_coll_elem_ere")]: ($) =>
      oneCharOrCollElem(
        $,
        $.ordinary_character,
        ...(nested ? [] : [alias(")", $.ordinary_character)]),
      ),
  };
}

function ereRules() {
  return {
    ...ereLevelRules(false),
    ...ereLevelRules(true),
    ere_dupl_symbol: ($) =>
      prec.right(
        seq(
          choice("*", "+", "?", interval($, "{", "}")),
          optional(field("modifier", alias("?", $.repetition_modifier))),
        ),
      ),
    ordinary_character: () => ERE_ORDINARY_CHARACTER,
    quoted_character: () => ERE_QUOTED_CHARACTER,
  };
}

function expressionTermRules(first) {
  const name = (rule) => (first ? `_leading_${rule}` : rule);
  const reference = ($, rule) => (first ? leading($, rule) : $[rule]);
  return {
    [name("expression_term")]: ($) =>
      choice(
        reference($, "single_expression"),
        reference($, "range_expression"),
      ),
    [name("single_expression")]: ($) =>
      choice(reference($, "end_range"), $.character_class, $.equivalence_class),
    [name("range_expression")]: ($) =>
      seq(reference($, "start_range"), choice($.end_range, "-")),
    [name("start_range")]: ($) => seq(reference($, "end_range"), "-"),
    [name("end_range")]: ($) =>
      choice(
        first
          ? alias($._leading_bracket_character, $.collating_element_single)
          : $.collating_element_single,
        nul($, "collating_element_single"),
        alias($._bracket_open_character, $.collating_element_single),
        $.collating_symbol,
      ),
  };
}

function sharedRules() {
  return {
    duplication_count: () => DUPLICATION_COUNT,

    bracket_expression: ($) =>
      seq("[", choice($.matching_list, $.nonmatching_list), "]"),
    matching_list: ($) => $.bracket_list,
    nonmatching_list: ($) => seq("^", $.bracket_list),
    bracket_list: ($) =>
      seq($.follow_list, optional(alias($._trailing_bracket_hyphen, "-"))),
    follow_list: ($) =>
      seq(leading($, "expression_term"), repeat($.expression_term)),
    ...expressionTermRules(false),
    ...expressionTermRules(true),
    _leading_bracket_character: () => BRACKET_CHARACTER,

    collating_symbol: ($) =>
      seq(
        "[",
        ".",
        field(
          "element",
          choice(
            alias($._collating_symbol_single, $.collating_element_single),
            alias($._collating_symbol_multi, $.collating_element_multi),
            alias($._collating_symbol_meta, $.meta_character),
          ),
        ),
        ".",
        "]",
      ),
    equivalence_class: ($) =>
      seq(
        "[",
        "=",
        field(
          "element",
          choice(
            alias($._equivalence_class_single, $.collating_element_single),
            alias($._equivalence_class_multi, $.collating_element_multi),
          ),
        ),
        "=",
        "]",
      ),
    character_class: ($) =>
      seq("[", ":", field("name", $.class_name), ":", "]"),
    class_name: () => CLASS_NAME,
    collating_element_single: () => COLLATING_ELEMENT_SINGLE,
  };
}

export default function defineGrammar(name, dialect) {
  const bre = dialect === "bre";
  const options = {
    name,

    extras: () => [],

    externals: ($) => [
      $._collating_symbol_single,
      $._collating_symbol_multi,
      $._collating_symbol_meta,
      $._equivalence_class_single,
      $._equivalence_class_multi,
      $._bracket_open_character,
      $._trailing_bracket_hyphen,
      ...(bre ? [$._bre_right_anchor] : []),
      $._error_sentinel,
    ],
  };
  return bre
    ? grammar({ ...options, rules: { ...breRules(), ...sharedRules() } })
    : grammar({ ...options, rules: { ...ereRules(), ...sharedRules() } });
}
