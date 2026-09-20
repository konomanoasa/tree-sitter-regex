const BRACKET_CHARACTER = /[^\x5b]/;
const COLLATING_ELEMENT_SINGLE = /[^\]\x5b-]/;
const CLASS_NAME = /[A-Za-z][A-Za-z0-9]*/;
const DUPLICATION_COUNT = /[0-9]+/;

const ERE_ORDINARY_CHARACTER = /[^^.\x5b$()|*+?{\\]/;
const ERE_QUOTED_CHARACTER = /\\[.\x5b\]$()|*+?{}\\^]/;
const BRE_ORDINARY_CHARACTER = /[^.\x5b*\\]/;
const BRE_LEADING_ORDINARY_CHARACTER = /[^.\x5b\\]/;
const BRE_QUOTED_CHARACTER = /\\[.*\x5b\]$\\^]/;
const BACKREFERENCE = /\\[1-9]/;

function leading($, name) {
  return alias($[`_leading_${name}`], $[name]);
}

// Negated classes exclude NUL, which is an ordinary source character.
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
    basic_reg_exp: ($) => seq($.bre_branch, repeat(seq("\\|", $.bre_branch))),
    // Keep anchor-only branches separate so `^` binds to a following operand.
    bre_branch: ($) =>
      choice(
        alias($._bre_anchor_only_expression, $.bre_expression),
        seq(leading($, "bre_expression"), repeat($.bre_expression)),
      ),
    _bre_anchor_only_expression: ($) => seq("^", optional(rightAnchor($))),
    _leading_bre_expression: ($) =>
      prec.right(
        choice(
          seq("^", leading($, "simple_bre"), optional(rightAnchor($))),
          seq(leading($, "simple_bre"), optional(rightAnchor($))),
          rightAnchor($),
        ),
      ),
    bre_expression: ($) =>
      prec.right(
        choice(seq($.simple_bre, optional(rightAnchor($))), rightAnchor($)),
      ),
    // Subexpressions have no anchors (BOUNDARY.md).
    _nested_basic_reg_exp: ($) =>
      seq(
        alias($._nested_bre_branch, $.bre_branch),
        repeat(seq("\\|", alias($._nested_bre_branch, $.bre_branch))),
      ),
    _nested_bre_branch: ($) =>
      seq(
        alias($._nested_leading_bre_expression, $.bre_expression),
        repeat(alias($._nested_bre_expression, $.bre_expression)),
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
      seq("\\(", alias($._nested_basic_reg_exp, $.basic_reg_exp), "\\)"),
    _leading_one_char_or_coll_elem_bre: ($) =>
      oneCharOrCollElem(
        $,
        alias($._bre_leading_ordinary_character, $.ordinary_character),
      ),
    one_char_or_coll_elem_bre: ($) =>
      oneCharOrCollElem($, $.ordinary_character),
    bre_dupl_symbol: ($) =>
      choice("*", "\\?", "\\+", interval($, "\\{", "\\}")),
    backreference: () => BACKREFERENCE,
    ordinary_character: () => BRE_ORDINARY_CHARACTER,
    quoted_character: () => BRE_QUOTED_CHARACTER,
    _bre_leading_ordinary_character: () => BRE_LEADING_ORDINARY_CHARACTER,
  };
}

function ereRules() {
  const rules = {};
  for (const nested of [false, true]) {
    const name = (rule) => (nested ? `_nested_${rule}` : rule);
    const reference = ($, rule) =>
      nested ? alias($[name(rule)], $[rule]) : $[rule];
    Object.assign(rules, {
      [name("extended_reg_exp")]: ($) =>
        seq(
          reference($, "ere_branch"),
          repeat(seq("|", reference($, "ere_branch"))),
        ),
      [name("ere_branch")]: ($) => repeat1(reference($, "ere_expression")),
      [name("ere_expression")]: ($) =>
        seq(
          choice(
            reference($, "one_char_or_coll_elem_ere"),
            "^",
            "$",
            seq(
              "(",
              alias($._nested_extended_reg_exp, $.extended_reg_exp),
              ")",
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
    });
  }
  return {
    ...rules,
    ere_dupl_symbol: ($) =>
      prec.right(
        seq(
          choice("*", "+", "?", interval($, "{", "}")),
          optional($.repetition_modifier),
        ),
      ),
    repetition_modifier: () => "?",
    ordinary_character: () => ERE_ORDINARY_CHARACTER,
    quoted_character: () => ERE_QUOTED_CHARACTER,
  };
}

function sharedRules() {
  return {
    duplication_count: () => DUPLICATION_COUNT,

    bracket_expression: ($) =>
      choice(seq("[", $.matching_list, "]"), seq("[", $.nonmatching_list, "]")),
    matching_list: ($) => $.bracket_list,
    nonmatching_list: ($) => seq("^", $.bracket_list),
    bracket_list: ($) =>
      seq($.follow_list, optional(alias($._trailing_bracket_hyphen, "-"))),
    follow_list: ($) =>
      seq(leading($, "expression_term"), repeat($.expression_term)),
    expression_term: ($) => choice($.single_expression, $.range_expression),
    single_expression: ($) =>
      choice($.end_range, $.character_class, $.equivalence_class),
    range_expression: ($) =>
      choice(seq($.start_range, $.end_range), seq($.start_range, "-")),
    start_range: ($) => seq($.end_range, "-"),
    end_range: ($) =>
      choice(
        $.collating_element_single,
        nul($, "collating_element_single"),
        alias($._bracket_open_character, $.collating_element_single),
        $.collating_symbol,
      ),

    _leading_expression_term: ($) =>
      choice(leading($, "single_expression"), leading($, "range_expression")),
    _leading_single_expression: ($) =>
      choice(leading($, "end_range"), $.character_class, $.equivalence_class),
    _leading_range_expression: ($) =>
      choice(
        seq(leading($, "start_range"), $.end_range),
        seq(leading($, "start_range"), "-"),
      ),
    _leading_start_range: ($) => seq(leading($, "end_range"), "-"),
    _leading_end_range: ($) =>
      choice(
        alias($._leading_bracket_character, $.collating_element_single),
        nul($, "collating_element_single"),
        alias($._bracket_open_character, $.collating_element_single),
        $.collating_symbol,
      ),
    _leading_bracket_character: () => BRACKET_CHARACTER,

    collating_symbol: ($) =>
      seq(
        "[.",
        choice(
          alias($._collating_symbol_single, $.collating_element_single),
          alias($._collating_symbol_multi, $.collating_element_multi),
          alias($._collating_symbol_meta, $.meta_character),
        ),
        ".]",
      ),
    equivalence_class: ($) =>
      seq(
        "[=",
        choice(
          alias($._equivalence_class_single, $.collating_element_single),
          alias($._equivalence_class_multi, $.collating_element_multi),
        ),
        "=]",
      ),
    character_class: ($) => seq("[:", $.class_name, ":]"),
    class_name: () => CLASS_NAME,
    collating_element_single: () => COLLATING_ELEMENT_SINGLE,
  };
}

export default function defineGrammar(name, dialect) {
  const bre = dialect === "bre";
  return grammar({
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

    rules: {
      ...(bre ? breRules() : ereRules()),
      ...sharedRules(),
    },
  });
}
