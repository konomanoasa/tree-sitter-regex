#ifndef JAVASCRIPT_REGEX_SCANNER_H
#define JAVASCRIPT_REGEX_SCANNER_H

#include "../scanner.h"
#include "tree_sitter/alloc.h"

enum TokenType {
  PATTERN_START,
  DECIMAL_START,
  OCTAL_ZERO,
  OCTAL_NONZERO,
  OCTAL_ZERO_TWO,
  OCTAL_FOUR_TWO,
  OCTAL_ZERO_THREE,
  IDENTITY_SOURCE,
  CLASS_IDENTITY_SOURCE,
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
  TOKEN_COUNT,
};

typedef struct {
  uint32_t capture_count;
  bool has_named_capture;
} Scanner;

static bool emit(TSLexer *lexer, const bool *valid, enum TokenType token) {
  if (!valid[token])
    return false;
  lexer->result_symbol = token;
  return true;
}

static bool scan_pattern_start(Scanner *scanner, TSLexer *lexer) {
  *scanner = (Scanner){0};
  bool in_class = false;
  lexer->mark_end(lexer);
  while (!lexer->eof(lexer)) {
    int32_t c = lexer->lookahead;
    lexer->advance(lexer, false);
    if (c == '\\') {
      if (!lexer->eof(lexer))
        lexer->advance(lexer, false);
    } else if (in_class) {
      if (c == ']')
        in_class = false;
    } else if (c == '[') {
      in_class = true;
    } else if (c == '(') {
      bool capture = lexer->lookahead != '?';
      if (!capture) {
        lexer->advance(lexer, false);
        if (lexer->lookahead == '<') {
          lexer->advance(lexer, false);
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

static bool scan_digits(
  const Scanner *scanner,
  TSLexer *lexer,
  const bool *valid,
  bool unicode
) {
  const int32_t first = lexer->lookahead;
  uint32_t decimal = 0;
  bool overflow = false;
  unsigned length = 0;
  unsigned octal_length = 0;
  const unsigned octal_limit = first <= '3' ? 3 : 2;
  bool octal = true;
  do {
    int32_t c = lexer->lookahead;
    if (decimal > (UINT32_MAX - (uint32_t)(c - '0')) / 10)
      overflow = true;
    if (!overflow)
      decimal = decimal * 10 + (uint32_t)(c - '0');
    octal = octal && regex_is_octal_digit(c);
    if (octal && octal_length < octal_limit)
      octal_length++;
    lexer->advance(lexer, false);
    if (length == 0)
      lexer->mark_end(lexer);
    if (length < 2)
      length++;
  } while (regex_is_ascii_digit(lexer->lookahead));
  if (
    first !=
    '0' &&
    (unicode || (!overflow && decimal <= scanner->capture_count)) &&
    valid[DECIMAL_START]
  ) {
    return emit(lexer, valid, DECIMAL_START);
  }
  if (first == '0' && length == 1)
    return emit(lexer, valid, NULL_ZERO);
  if (unicode)
    return false;
  if (octal_length == 0) {
    return emit(
      lexer,
      valid,
      valid[CLASS_IDENTITY_SOURCE] ? CLASS_IDENTITY_SOURCE : IDENTITY_SOURCE
    );
  }
  enum TokenType token = octal_length == 3 ? OCTAL_ZERO_THREE
    : octal_length == 2 ? (first <= '3' ? OCTAL_ZERO_TWO : OCTAL_FOUR_TWO)
    : first == '0'      ? OCTAL_ZERO
                        : OCTAL_NONZERO;
  return emit(lexer, valid, token);
}

static bool scan_brace(TSLexer *lexer, const bool *valid) {
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  bool complete = regex_scan_interval_tail(lexer, true);
  return emit(lexer, valid, complete ? QUANTIFIER_OPEN : LITERAL_OPEN_BRACE);
}

static bool scan_unicode_escape(TSLexer *lexer, const bool *valid) {
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  if (lexer->lookahead == '{' && valid[UNICODE_CODE_POINT_START]) {
    lexer->advance(lexer, false);
    uint32_t value = 0;
    bool any = false;
    while (regex_is_hexadecimal_digit(lexer->lookahead)) {
      any = true;
      if (value <= 0x10ffff)
        value = value * 16 + regex_hexadecimal_value(lexer->lookahead);
      lexer->advance(lexer, false);
    }
    return any &&
      value <=
      0x10ffff &&
      lexer->lookahead ==
      '}' &&
      emit(lexer, valid, UNICODE_CODE_POINT_START);
  }
  uint32_t value;
  if (!regex_scan_hexadecimal_digits(lexer, 4, &value)) {
    return emit(
      lexer,
      valid,
      valid[CLASS_IDENTITY_SOURCE] ? CLASS_IDENTITY_SOURCE : IDENTITY_SOURCE
    );
  }
  if (valid[UNICODE_FIXED_START])
    return emit(lexer, valid, UNICODE_FIXED_START);
  enum TokenType token = value >= 0xd800 && value <= 0xdbff ? UNICODE_LEAD_START
    : value >= 0xdc00 && value <= 0xdfff ? UNICODE_TRAIL_START
                                         : UNICODE_NON_SURROGATE_START;
  if (token == UNICODE_LEAD_START && lexer->lookahead == '\\') {
    lexer->advance(lexer, false);
    if (lexer->lookahead == 'u') {
      lexer->advance(lexer, false);
      if (
        regex_scan_hexadecimal_digits(lexer, 4, &value) &&
        value >=
        0xdc00 &&
        value <= 0xdfff
      )
        token = UNICODE_PAIR_START;
    }
  }
  return emit(lexer, valid, token);
}

static bool reserved_double(int32_t c) {
  switch (c) {
  case '&':
  case '!':
  case '#':
  case '$':
  case '%':
  case '*':
  case '+':
  case ',':
  case '.':
  case ':':
  case ';':
  case '<':
  case '=':
  case '>':
  case '?':
  case '@':
  case '^':
  case '`':
  case '~':
    return true;
  default:
    return false;
  }
}

static bool scan_set_character(TSLexer *lexer, const bool *valid) {
  int32_t first = lexer->lookahead;
  if (lexer->eof(lexer))
    return false;
  if (first == '^' && valid[CLASS_NEGATION]) {
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    return emit(lexer, valid, CLASS_NEGATION);
  }
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  if (first == '-' && lexer->lookahead == '-') {
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    return emit(lexer, valid, CLASS_SUBTRACTION);
  }
  if (reserved_double(first) && lexer->lookahead == first) {
    if (first != '&')
      return false;
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    return lexer->lookahead != '&' && emit(lexer, valid, CLASS_INTERSECTION);
  }
  switch (first) {
  case '(':
  case ')':
  case '[':
  case ']':
  case '{':
  case '}':
  case '/':
  case '-':
  case '\\':
  case '|':
    return false;
  default:
    return emit(lexer, valid, CLASS_SET_RAW_CHARACTER);
  }
}

static bool
scan_regex(Scanner *scanner, TSLexer *lexer, const bool *valid, unsigned mode) {
  if (valid[PATTERN_START] && valid[DECIMAL_START])
    return false;
  if (mode == 0 && valid[PATTERN_START])
    return scan_pattern_start(scanner, lexer);
  if (lexer->eof(lexer))
    return false;
  if (
    mode ==
    2 &&
    (valid[CLASS_SET_RAW_CHARACTER] ||
      valid[CLASS_NEGATION] ||
      valid[CLASS_INTERSECTION] ||
      valid[CLASS_SUBTRACTION])
  ) {
    if (lexer->lookahead != '\\')
      return scan_set_character(lexer, valid);
  }
  int32_t c = lexer->lookahead;
  if (c == '\\' && valid[UNICODE_PAIR_SEPARATOR]) {
    lexer->advance(lexer, false);
    if (lexer->lookahead != 'u')
      return false;
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    return emit(lexer, valid, UNICODE_PAIR_SEPARATOR);
  }
  if (c == '{' && (valid[QUANTIFIER_OPEN] || valid[LITERAL_OPEN_BRACE]))
    return scan_brace(lexer, valid);
  if (
    regex_is_ascii_digit(c) &&
    (valid[DECIMAL_START] ||
      valid[NULL_ZERO] ||
      valid[OCTAL_ZERO] ||
      valid[OCTAL_NONZERO] ||
      valid[OCTAL_ZERO_TWO] ||
      valid[OCTAL_FOUR_TWO] ||
      valid[OCTAL_ZERO_THREE] ||
      valid[IDENTITY_SOURCE] ||
      valid[CLASS_IDENTITY_SOURCE])
  ) {
    return scan_digits(scanner, lexer, valid, mode != 0);
  }
  if (
    c ==
    'u' &&
    (valid[UNICODE_FIXED_START] ||
      valid[UNICODE_PAIR_START] ||
      valid[UNICODE_LEAD_START] ||
      valid[UNICODE_TRAIL_START] ||
      valid[UNICODE_NON_SURROGATE_START] ||
      valid[UNICODE_CODE_POINT_START])
  )
    return scan_unicode_escape(lexer, valid);
  if (
    c == '\\' && (valid[LITERAL_BACKSLASH] || valid[CLASS_LITERAL_BACKSLASH])
  ) {
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    if (lexer->lookahead != 'c')
      return false;
    lexer->advance(lexer, false);
    if (regex_is_ascii_letter(lexer->lookahead))
      return false;
    bool in_class = valid[CLASS_LITERAL_BACKSLASH];
    if (
      in_class &&
      (regex_is_ascii_digit(lexer->lookahead) || lexer->lookahead == '_')
    )
      return false;
    return emit(
      lexer,
      valid,
      in_class ? CLASS_LITERAL_BACKSLASH : LITERAL_BACKSLASH
    );
  }
  if (!(valid[IDENTITY_SOURCE] ||
        valid[CLASS_IDENTITY_SOURCE] ||
        valid[HEX_START] ||
        valid[CONTROL_START] ||
        valid[CLASS_CONTROL_START] ||
        valid[NAMED_REFERENCE_START]))
    return false;
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  if (c == 'c') {
    if (regex_is_ascii_letter(lexer->lookahead))
      return emit(lexer, valid, CONTROL_START);
    if (regex_is_ascii_digit(lexer->lookahead) || lexer->lookahead == '_')
      return emit(lexer, valid, CLASS_CONTROL_START);
    return false;
  }
  if (c == 'x') {
    if (regex_is_hexadecimal_digit(lexer->lookahead)) {
      lexer->advance(lexer, false);
      if (regex_is_hexadecimal_digit(lexer->lookahead))
        return emit(lexer, valid, HEX_START);
    }
  } else if (c == 'k' && (mode != 0 || scanner->has_named_capture)) {
    return lexer->lookahead == '<' && emit(lexer, valid, NAMED_REFERENCE_START);
  } else {
    switch (c) {
    case 'b':
    case 'd':
    case 'D':
    case 's':
    case 'S':
    case 'w':
    case 'W':
    case 'f':
    case 'n':
    case 'r':
    case 't':
    case 'v':
      return false;
    case 'B':
      if (!valid[CLASS_IDENTITY_SOURCE])
        return false;
    }
  }
  return emit(
    lexer,
    valid,
    valid[CLASS_IDENTITY_SOURCE] ? CLASS_IDENTITY_SOURCE : IDENTITY_SOURCE
  );
}

#define DEFINE_SCANNER(name, mode) \
  void *tree_sitter_##name##_external_scanner_create(void) { \
    return mode == 0 ? ts_calloc(1, sizeof(Scanner)) : NULL; \
  } \
  void tree_sitter_##name##_external_scanner_destroy(void *payload) { \
    ts_free(payload); \
  } \
  unsigned tree_sitter_##name##_external_scanner_serialize( \
    void *payload, \
    char *buffer \
  ) { \
    if (mode != 0) \
      return 0; \
    const Scanner *scanner = payload; \
    for (unsigned i = 0; i < 4; i++) \
      buffer[i] = (char)(scanner->capture_count >> (8 * i)); \
    buffer[4] = (char)scanner->has_named_capture; \
    return 5; \
  } \
  void tree_sitter_##name##_external_scanner_deserialize( \
    void *payload, \
    const char *buffer, \
    unsigned length \
  ) { \
    if (mode != 0) \
      return; \
    Scanner *scanner = payload; \
    *scanner = (Scanner){0}; \
    if (length == 5) { \
      for (unsigned i = 0; i < 4; i++) \
        scanner->capture_count |= (uint32_t)(unsigned char)buffer[i] \
          << (8 * i); \
      scanner->has_named_capture = buffer[4] != 0; \
    } \
  } \
  bool tree_sitter_##name##_external_scanner_scan( \
    void *payload, \
    TSLexer *lexer, \
    const bool *valid \
  ) { \
    return scan_regex(payload, lexer, valid, mode); \
  }

#endif
