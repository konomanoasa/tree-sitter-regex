#ifndef ECMAREGEX_SCANNER_H
#define ECMAREGEX_SCANNER_H

#include "tree_sitter/alloc.h"
#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#ifndef ECMAREGEX_MODE
#error "ECMAREGEX_MODE must be 0 (ordinary), 1 (u), or 2 (v)"
#elif ECMAREGEX_MODE == 0
#define ECMAREGEX_LANGUAGE ecmaregex
#elif ECMAREGEX_MODE == 1
#define ECMAREGEX_LANGUAGE ecmaregex_u
#elif ECMAREGEX_MODE == 2
#define ECMAREGEX_LANGUAGE ecmaregex_v
#else
#error "ECMAREGEX_MODE must be 0 (ordinary), 1 (u), or 2 (v)"
#endif

#define REGEX_SCANNER_ENTRY_INNER(language, suffix) \
  tree_sitter_##language##_external_scanner_##suffix
#define REGEX_SCANNER_ENTRY(language, suffix) \
  REGEX_SCANNER_ENTRY_INNER(language, suffix)

#define REGEX_SCANNER(suffix) REGEX_SCANNER_ENTRY(ECMAREGEX_LANGUAGE, suffix)

enum TokenType {
  PATTERN_START,
  DECIMAL_START,
  OCTAL_ZERO,
  OCTAL_NONZERO,
  OCTAL_ZERO_TWO,
  OCTAL_FOUR_TWO,
  OCTAL_ZERO_THREE,
  IDENTITY_SOURCE,
  NULL_ZERO,
  HEX_START,
  UNICODE_FIXED_START,
  UNICODE_PAIR_START,
  UNICODE_LEAD_START,
  UNICODE_TRAIL_START,
  UNICODE_NON_SURROGATE_START,
  UNICODE_CODE_POINT_START,
  CONTROL_START,
  CLASS_CONTROL_START,
  NAMED_REFERENCE_START,
  LITERAL_BACKSLASH,
  CLASS_LITERAL_BACKSLASH,
  LITERAL_OPEN_BRACE,
  QUANTIFIER_OPEN,
  CLASS_SET_RAW_CHARACTER,
  CLASS_INTERSECTION,
  CLASS_SUBTRACTION,
  CLASS_NEGATION,
  UNICODE_PAIR_SEPARATOR,
  ERROR_SENTINEL,
};

typedef struct {
  uint32_t capture_count;
  bool has_named_capture;
} Scanner;

static void advance(TSLexer *lexer) {
  lexer->advance(lexer, false);
}

static bool is_ascii_digit(int32_t character) {
  return character >= '0' && character <= '9';
}

static bool is_octal_digit(int32_t character) {
  return character >= '0' && character <= '7';
}

static bool is_hexadecimal_digit(int32_t character) {
  return is_ascii_digit(character) ||
    (character >= 'A' && character <= 'F') ||
    (character >= 'a' && character <= 'f');
}

static uint32_t hexadecimal_value(int32_t character) {
  return character <= '9' ? (uint32_t)(character - '0')
                          : (uint32_t)((character | 32) - 'a' + 10);
}

static bool is_ascii_letter(int32_t character) {
  return (character >= 'A' && character <= 'Z') ||
    (character >= 'a' && character <= 'z');
}

static bool is_class_control_letter(int32_t character) {
  return is_ascii_digit(character) || character == '_';
}

static bool is_lead_surrogate(uint32_t value) {
  return value >= 0xd800 && value <= 0xdbff;
}

static bool is_trail_surrogate(uint32_t value) {
  return value >= 0xdc00 && value <= 0xdfff;
}

static bool is_one_of(const char *characters, int32_t character) {
  return character > 0 &&
    character < 128 &&
    strchr(characters, character) != NULL;
}

static void skip_ascii_digits(TSLexer *lexer) {
  while (is_ascii_digit(lexer->lookahead)) advance(lexer);
}

static bool
scan_hexadecimal_digits(TSLexer *lexer, unsigned length, uint32_t *value) {
  uint32_t result = 0;
  for (unsigned index = 0; index < length; index++) {
    if (!is_hexadecimal_digit(lexer->lookahead)) return false;
    result = result * 16 + hexadecimal_value(lexer->lookahead);
    advance(lexer);
  }
  *value = result;
  return true;
}

static bool emit(TSLexer *lexer, const bool *valid, enum TokenType token) {
  if (!valid[token]) return false;
  lexer->result_symbol = token;
  return true;
}

static bool expects_class_set_token(const bool *valid) {
  return valid[CLASS_SET_RAW_CHARACTER] ||
    valid[CLASS_NEGATION] ||
    valid[CLASS_INTERSECTION] ||
    valid[CLASS_SUBTRACTION];
}

static bool expects_digit_escape(const bool *valid) {
  return valid[DECIMAL_START] ||
    valid[NULL_ZERO] ||
    valid[OCTAL_ZERO] ||
    valid[OCTAL_NONZERO] ||
    valid[OCTAL_ZERO_TWO] ||
    valid[OCTAL_FOUR_TWO] ||
    valid[OCTAL_ZERO_THREE] ||
    valid[IDENTITY_SOURCE];
}

static bool expects_unicode_escape(const bool *valid) {
  return valid[UNICODE_FIXED_START] ||
    valid[UNICODE_PAIR_START] ||
    valid[UNICODE_LEAD_START] ||
    valid[UNICODE_TRAIL_START] ||
    valid[UNICODE_NON_SURROGATE_START] ||
    valid[UNICODE_CODE_POINT_START];
}

static bool expects_escaped_character(const bool *valid) {
  return valid[IDENTITY_SOURCE] ||
    valid[HEX_START] ||
    valid[CONTROL_START] ||
    valid[CLASS_CONTROL_START] ||
    valid[NAMED_REFERENCE_START];
}

// Annex B escape classification needs captures from the whole pattern.
static bool scan_pattern_start(Scanner *scanner, TSLexer *lexer) {
  *scanner = (Scanner){0};
  bool in_class = false;
  lexer->mark_end(lexer);
  while (!lexer->eof(lexer)) {
    int32_t c = lexer->lookahead;
    advance(lexer);
    if (c == '\\') {
      if (!lexer->eof(lexer)) advance(lexer);
    } else if (in_class) {
      if (c == ']') in_class = false;
    } else if (c == '[') {
      in_class = true;
    } else if (c == '(') {
      bool capture = lexer->lookahead != '?';
      if (!capture) {
        advance(lexer);
        if (lexer->lookahead == '<') {
          advance(lexer);
          capture = lexer->lookahead != '=' && lexer->lookahead != '!';
          scanner->has_named_capture |= capture;
        }
      }
      if (capture && scanner->capture_count < UINT32_MAX)
        scanner->capture_count++;
    }
  }
  lexer->result_symbol = PATTERN_START;
  return true;
}

static bool
scan_digits(const Scanner *scanner, TSLexer *lexer, const bool *valid) {
  const bool unicode = ECMAREGEX_MODE != 0;
  const int32_t first = lexer->lookahead;
  const unsigned octal_limit = first <= '3' ? 3 : 2;
  uint64_t decimal = 0;
  bool octal = true;
  unsigned octal_length = 0;
  unsigned count = 0;
  do {
    int32_t c = lexer->lookahead;
    if (decimal <= UINT32_MAX) decimal = decimal * 10 + (uint64_t)(c - '0');
    octal = octal && is_octal_digit(c);
    if (octal && octal_length < octal_limit) octal_length++;
    advance(lexer);
    if (++count == 1) lexer->mark_end(lexer);
  } while (is_ascii_digit(lexer->lookahead));
  if (
    first != '0' &&
    (unicode || decimal <= scanner->capture_count) &&
    valid[DECIMAL_START]
  ) {
    return emit(lexer, valid, DECIMAL_START);
  }
  if (first == '0' && count == 1) return emit(lexer, valid, NULL_ZERO);
  if (unicode) return false;
  if (octal_length == 0) return emit(lexer, valid, IDENTITY_SOURCE);
  enum TokenType token = octal_length == 3 ? OCTAL_ZERO_THREE
    : octal_length == 2 ? (first <= '3' ? OCTAL_ZERO_TWO : OCTAL_FOUR_TWO)
    : first == '0'      ? OCTAL_ZERO
                        : OCTAL_NONZERO;
  return emit(lexer, valid, token);
}

static bool scan_interval_tail(TSLexer *lexer) {
  if (!is_ascii_digit(lexer->lookahead)) return false;
  skip_ascii_digits(lexer);
  if (lexer->lookahead == '}') return true;
  if (lexer->lookahead != ',') return false;
  advance(lexer);
  skip_ascii_digits(lexer);
  return lexer->lookahead == '}';
}

static bool scan_brace(TSLexer *lexer, const bool *valid) {
  advance(lexer);
  lexer->mark_end(lexer);
  bool complete = scan_interval_tail(lexer);
  return emit(lexer, valid, complete ? QUANTIFIER_OPEN : LITERAL_OPEN_BRACE);
}

static bool scan_braced_code_point(TSLexer *lexer) {
  advance(lexer);
  uint32_t value = 0;
  bool found = false;
  while (is_hexadecimal_digit(lexer->lookahead)) {
    found = true;
    if (value <= 0x10ffff)
      value = value * 16 + hexadecimal_value(lexer->lookahead);
    advance(lexer);
  }
  return found && value <= 0x10ffff && lexer->lookahead == '}';
}

static bool scan_trail_surrogate_escape(TSLexer *lexer) {
  if (lexer->lookahead != '\\') return false;
  advance(lexer);
  if (lexer->lookahead != 'u') return false;
  advance(lexer);
  uint32_t value;
  return scan_hexadecimal_digits(lexer, 4, &value) && is_trail_surrogate(value);
}

static bool scan_unicode_escape(TSLexer *lexer, const bool *valid) {
  advance(lexer);
  lexer->mark_end(lexer);
  if (lexer->lookahead == '{' && valid[UNICODE_CODE_POINT_START])
    return scan_braced_code_point(lexer) &&
      emit(lexer, valid, UNICODE_CODE_POINT_START);
  uint32_t value;
  if (!scan_hexadecimal_digits(lexer, 4, &value))
    return emit(lexer, valid, IDENTITY_SOURCE);
  if (valid[UNICODE_FIXED_START])
    return emit(lexer, valid, UNICODE_FIXED_START);
  if (is_lead_surrogate(value))
    return emit(
      lexer,
      valid,
      scan_trail_surrogate_escape(lexer) ? UNICODE_PAIR_START
                                         : UNICODE_LEAD_START
    );
  return emit(
    lexer,
    valid,
    is_trail_surrogate(value) ? UNICODE_TRAIL_START
                              : UNICODE_NON_SURROGATE_START
  );
}

static bool scan_pair_separator(TSLexer *lexer, const bool *valid) {
  advance(lexer);
  if (lexer->lookahead != 'u') return false;
  advance(lexer);
  lexer->mark_end(lexer);
  return emit(lexer, valid, UNICODE_PAIR_SEPARATOR);
}

static bool scan_literal_backslash(TSLexer *lexer, const bool *valid) {
  advance(lexer);
  lexer->mark_end(lexer);
  if (lexer->lookahead != 'c') return false;
  advance(lexer);
  if (is_ascii_letter(lexer->lookahead)) return false;
  bool in_class = valid[CLASS_LITERAL_BACKSLASH];
  if (in_class && is_class_control_letter(lexer->lookahead)) return false;
  return emit(
    lexer,
    valid,
    in_class ? CLASS_LITERAL_BACKSLASH : LITERAL_BACKSLASH
  );
}

static bool scan_escaped_character(
  const Scanner *scanner,
  TSLexer *lexer,
  const bool *valid
) {
  const int32_t c = lexer->lookahead;
  advance(lexer);
  lexer->mark_end(lexer);
  if (c == 'c') {
    if (is_ascii_letter(lexer->lookahead))
      return emit(lexer, valid, CONTROL_START);
    return is_class_control_letter(lexer->lookahead) &&
      emit(lexer, valid, CLASS_CONTROL_START);
  }
  if (c == 'x' && is_hexadecimal_digit(lexer->lookahead)) {
    advance(lexer);
    if (is_hexadecimal_digit(lexer->lookahead))
      return emit(lexer, valid, HEX_START);
  }
  if (c == 'k' && (ECMAREGEX_MODE != 0 || scanner->has_named_capture))
    return lexer->lookahead == '<' && emit(lexer, valid, NAMED_REFERENCE_START);
  return !is_one_of("bdDsSwWfnrtv", c) && emit(lexer, valid, IDENTITY_SOURCE);
}

static bool scan_class_set_character(TSLexer *lexer, const bool *valid) {
  const int32_t first = lexer->lookahead;
  advance(lexer);
  lexer->mark_end(lexer);
  if (first == '^' && valid[CLASS_NEGATION])
    return emit(lexer, valid, CLASS_NEGATION);
  if (first == '-' && lexer->lookahead == '-') {
    advance(lexer);
    lexer->mark_end(lexer);
    return emit(lexer, valid, CLASS_SUBTRACTION);
  }
  if (is_one_of("&!#$%*+,.:;<=>?@^`~", first) && lexer->lookahead == first) {
    if (first != '&') return false;
    advance(lexer);
    lexer->mark_end(lexer);
    return lexer->lookahead != '&' && emit(lexer, valid, CLASS_INTERSECTION);
  }
  return !is_one_of("()[]{}/-\\|", first) &&
    emit(lexer, valid, CLASS_SET_RAW_CHARACTER);
}

static bool scan(Scanner *scanner, TSLexer *lexer, const bool *valid) {
  if (valid[ERROR_SENTINEL]) return false;
  if (ECMAREGEX_MODE == 0 && valid[PATTERN_START])
    return scan_pattern_start(scanner, lexer);
  if (lexer->eof(lexer)) return false;
  const int32_t c = lexer->lookahead;
  if (ECMAREGEX_MODE == 2 && c != '\\' && expects_class_set_token(valid))
    return scan_class_set_character(lexer, valid);
  if (c == '\\') {
    if (valid[UNICODE_PAIR_SEPARATOR]) return scan_pair_separator(lexer, valid);
    if (valid[LITERAL_BACKSLASH] || valid[CLASS_LITERAL_BACKSLASH])
      return scan_literal_backslash(lexer, valid);
  }
  if (c == '{' && (valid[QUANTIFIER_OPEN] || valid[LITERAL_OPEN_BRACE]))
    return scan_brace(lexer, valid);
  if (is_ascii_digit(c) && expects_digit_escape(valid))
    return scan_digits(scanner, lexer, valid);
  if (c == 'u' && expects_unicode_escape(valid))
    return scan_unicode_escape(lexer, valid);
  return expects_escaped_character(valid) &&
    scan_escaped_character(scanner, lexer, valid);
}

void *REGEX_SCANNER(create)(void) {
  return ECMAREGEX_MODE == 0 ? ts_calloc(1, sizeof(Scanner)) : NULL;
}

void REGEX_SCANNER(destroy)(void *payload) {
  ts_free(payload);
}

unsigned REGEX_SCANNER(serialize)(void *payload, char *buffer) {
  const Scanner *scanner = payload;
  if (!scanner || (scanner->capture_count == 0 && !scanner->has_named_capture))
    return 0;
  for (unsigned i = 0; i < 4; i++)
    buffer[i] = (char)(scanner->capture_count >> (8 * i));
  buffer[4] = (char)scanner->has_named_capture;
  return 5;
}

void REGEX_SCANNER(deserialize)(
  void *payload,
  const char *buffer,
  unsigned length
) {
  Scanner *scanner = payload;
  if (!scanner) return;
  *scanner = (Scanner){0};
  if (length == 5) {
    for (unsigned i = 0; i < 4; i++)
      scanner->capture_count |= (uint32_t)(unsigned char)buffer[i] << (8 * i);
    scanner->has_named_capture = buffer[4] != 0;
  }
}

bool REGEX_SCANNER(scan)(void *payload, TSLexer *lexer, const bool *valid) {
  return (ECMAREGEX_MODE != 0 || payload) && scan(payload, lexer, valid);
}

#endif
