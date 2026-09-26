#ifndef PYTHON_RE_SCANNER_H
#define PYTHON_RE_SCANNER_H

#include "../scanner.h"
#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifndef PYTHON_RE_LANGUAGE
#error "PYTHON_RE_LANGUAGE must name the generated Tree-sitter language"
#endif

enum PythonReTokenType {
  GLOBAL_FLAGS_START,
  SCOPED_FLAGS_START,
  ENABLE_FLAGS_WITH_X,
  ENABLE_FLAGS_WITHOUT_X,
  DISABLE_FLAGS_WITH_X,
  DISABLE_FLAGS_WITHOUT_X,
  ANGLE_GROUP_NAME,
  PARENTHESIZED_GROUP_NAME,
  CONDITIONAL_GROUP_ID,
  COMMENT_GROUP_CONTENT,
  VERBOSE_COMMENT,
  LITERAL_ESCAPE,
  HEX_ESCAPE_START,
  UNICODE_ESCAPE_SHORT_START,
  UNICODE_ESCAPE_LONG_START,
  NAMED_UNICODE_ESCAPE_START,
  UNICODE_CHARACTER_NAME,
  NUMERIC_ESCAPE_START,
  CLASS_NEGATION,
  CLASS_CHARACTER,
  OPEN_BRACE,
  QUANTIFIER_QUESTION,
  QUANTIFIER_LAZY_SUFFIX,
  LITERAL_CHARACTER_NORMAL,
  LITERAL_CHARACTER_VERBOSE,
  ERROR_SENTINEL,
};

static bool python_re_is_ascii_digit(int32_t character) {
  return character >= '0' && character <= '9';
}

static bool python_re_is_octal_digit(int32_t character) {
  return character >= '0' && character <= '7';
}

static bool python_re_is_hexadecimal_digit(int32_t character) {
  return python_re_is_ascii_digit(character) ||
    (character >= 'A' && character <= 'F') ||
    (character >= 'a' && character <= 'f');
}

static bool python_re_is_ascii_letter(int32_t character) {
  return (character >= 'A' && character <= 'Z') ||
    (character >= 'a' && character <= 'z');
}

static bool python_re_skip_ascii_digits(TSLexer *lexer) {
  bool has_digit = false;
  while (python_re_is_ascii_digit(lexer->lookahead)) {
    has_digit = true;
    lexer->advance(lexer, false);
  }
  return has_digit;
}

static bool python_re_scan_interval_tail(TSLexer *lexer) {
  bool has_minimum = python_re_skip_ascii_digits(lexer);
  if (lexer->lookahead == '}')
    return has_minimum;
  if (lexer->lookahead != ',')
    return false;
  lexer->advance(lexer, false);
  python_re_skip_ascii_digits(lexer);
  return lexer->lookahead == '}';
}

static bool python_re_scan_hexadecimal_digits(TSLexer *lexer, unsigned length) {
  for (unsigned index = 0; index < length; index++) {
    if (!python_re_is_hexadecimal_digit(lexer->lookahead))
      return false;
    lexer->advance(lexer, false);
  }
  return true;
}

static bool python_re_is_flag(int32_t character, bool enable) {
  switch (character) {
  case 'a':
  case 'L':
  case 'u':
    return enable;
  case 'i':
  case 'm':
  case 's':
  case 'x':
    return true;
  default:
    return false;
  }
}

static bool python_re_is_whitespace(int32_t character) {
  switch (character) {
  case ' ':
  case '\t':
  case '\n':
  case '\v':
  case '\f':
  case '\r':
    return true;
  default:
    return false;
  }
}

static bool python_re_is_metacharacter(int32_t character) {
  switch (character) {
  case '.':
  case '^':
  case '$':
  case '\\':
  case '(':
  case ')':
  case '[':
  case '*':
  case '+':
  case '?':
  case '|':
    return true;
  default:
    return false;
  }
}

static bool python_re_emit(TSLexer *lexer, uint16_t token) {
  lexer->mark_end(lexer);
  lexer->result_symbol = token;
  return true;
}

static bool
python_re_scan_character(TSLexer *lexer, int32_t character, uint16_t token) {
  if (lexer->lookahead != character) {
    return false;
  }
  lexer->advance(lexer, false);
  return python_re_emit(lexer, token);
}

static bool python_re_skip_flags(TSLexer *lexer, bool enable) {
  bool has_flag = false;
  while (python_re_is_flag(lexer->lookahead, enable)) {
    has_flag = true;
    lexer->advance(lexer, false);
  }
  return has_flag;
}

static bool
python_re_scan_flags_start(TSLexer *lexer, const bool *valid_symbols) {
  if (lexer->lookahead != '(') {
    return false;
  }
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  if (lexer->lookahead != '?') {
    return false;
  }
  lexer->advance(lexer, false);
  bool has_enable = python_re_skip_flags(lexer, true);
  if (lexer->lookahead == ')' && has_enable) {
    if (!valid_symbols[GLOBAL_FLAGS_START]) {
      return false;
    }
    lexer->result_symbol = GLOBAL_FLAGS_START;
    return true;
  }
  if (lexer->lookahead == '-') {
    lexer->advance(lexer, false);
    if (!python_re_skip_flags(lexer, false)) {
      return false;
    }
  } else if (!has_enable) {
    return false;
  }
  if (lexer->lookahead != ':' || !valid_symbols[SCOPED_FLAGS_START]) {
    return false;
  }
  lexer->result_symbol = SCOPED_FLAGS_START;
  return true;
}

static bool python_re_scan_flag_set(
  TSLexer *lexer,
  const bool *valid_symbols,
  bool enable
) {
  bool has_character = false;
  bool has_x = false;
  while (python_re_is_flag(lexer->lookahead, enable)) {
    has_character = true;
    has_x = has_x || lexer->lookahead == 'x';
    lexer->advance(lexer, false);
  }
  uint16_t token = enable
    ? (has_x ? ENABLE_FLAGS_WITH_X : ENABLE_FLAGS_WITHOUT_X)
    : (has_x ? DISABLE_FLAGS_WITH_X : DISABLE_FLAGS_WITHOUT_X);
  return has_character && valid_symbols[token] && python_re_emit(lexer, token);
}

static bool python_re_scan_payload(
  TSLexer *lexer,
  const bool *valid_symbols,
  int32_t terminator,
  uint16_t token,
  uint16_t digits_token
) {
  if (lexer->eof(lexer) || lexer->lookahead == terminator) {
    return false;
  }
  bool all_digits = true;
  do {
    all_digits = all_digits && python_re_is_ascii_digit(lexer->lookahead);
    lexer->advance(lexer, false);
  } while (!lexer->eof(lexer) && lexer->lookahead != terminator);
  uint16_t result =
    all_digits && valid_symbols[digits_token] ? digits_token : token;
  return valid_symbols[result] && python_re_emit(lexer, result);
}

static bool
python_re_scan_comment(TSLexer *lexer, int32_t terminator, uint16_t token) {
  if (lexer->eof(lexer) || lexer->lookahead == terminator) {
    return false;
  }
  do {
    bool escaped = lexer->lookahead == '\\';
    lexer->advance(lexer, false);
    if (escaped && !lexer->eof(lexer)) {
      lexer->advance(lexer, false);
    }
  } while (!lexer->eof(lexer) && lexer->lookahead != terminator);
  return python_re_emit(lexer, token);
}

static uint16_t python_re_literal_token(const bool *valid_symbols) {
  return valid_symbols[LITERAL_CHARACTER_NORMAL] ? LITERAL_CHARACTER_NORMAL
                                                 : LITERAL_CHARACTER_VERBOSE;
}

static bool python_re_scan_brace(TSLexer *lexer, const bool *valid_symbols) {
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  uint16_t token = python_re_scan_interval_tail(lexer)
    ? OPEN_BRACE
    : python_re_literal_token(valid_symbols);
  if (!valid_symbols[token]) {
    return false;
  }
  lexer->result_symbol = token;
  return true;
}

static bool python_re_scan_escape(
  TSLexer *lexer,
  const bool *valid_symbols,
  bool in_class
) {
  lexer->advance(lexer, false);
  if (lexer->eof(lexer)) {
    return false;
  }
  int32_t character = lexer->lookahead;
  unsigned digits = character == 'x' ? 2
    : character == 'u'               ? 4
    : character == 'U'               ? 8
                                     : 0;
  if (digits != 0) {
    uint16_t token = character == 'x' ? HEX_ESCAPE_START
      : character == 'u'              ? UNICODE_ESCAPE_SHORT_START
                                      : UNICODE_ESCAPE_LONG_START;
    if (!valid_symbols[token]) {
      return false;
    }
    lexer->advance(lexer, false);
    lexer->mark_end(lexer);
    if (!python_re_scan_hexadecimal_digits(lexer, digits))
      return false;
    lexer->result_symbol = token;
    return true;
  }
  if (character == 'N' && valid_symbols[NAMED_UNICODE_ESCAPE_START]) {
    lexer->advance(lexer, false);
    return lexer->lookahead ==
      '{' &&
      python_re_emit(lexer, NAMED_UNICODE_ESCAPE_START);
  }
  if (python_re_is_ascii_digit(character)) {
    if (
      !valid_symbols[NUMERIC_ESCAPE_START] ||
      (in_class && !python_re_is_octal_digit(character))
    ) {
      return false;
    }
    return python_re_emit(lexer, NUMERIC_ESCAPE_START);
  }
  if (python_re_is_ascii_letter(character) || !valid_symbols[LITERAL_ESCAPE]) {
    return false;
  }
  lexer->advance(lexer, false);
  return python_re_emit(lexer, LITERAL_ESCAPE);
}

static bool python_re_scan(TSLexer *lexer, const bool *valid_symbols) {
  if (valid_symbols[ERROR_SENTINEL] || lexer->eof(lexer)) {
    return false;
  }
  static const struct {
    int32_t terminator;
    uint16_t token;
    uint16_t digits_token;
  } payloads[] = {
    {'}', UNICODE_CHARACTER_NAME, UNICODE_CHARACTER_NAME},
    {'>', ANGLE_GROUP_NAME, ANGLE_GROUP_NAME},
    {')', PARENTHESIZED_GROUP_NAME, CONDITIONAL_GROUP_ID},
  };
  for (
    unsigned index = 0; index < sizeof(payloads) / sizeof(payloads[0]);
    index += 1
  ) {
    if (
      valid_symbols[payloads[index].token] ||
      valid_symbols[payloads[index].digits_token]
    ) {
      return python_re_scan_payload(
        lexer,
        valid_symbols,
        payloads[index].terminator,
        payloads[index].token,
        payloads[index].digits_token
      );
    }
  }
  if (valid_symbols[COMMENT_GROUP_CONTENT]) {
    return python_re_scan_comment(lexer, ')', COMMENT_GROUP_CONTENT);
  }
  if (
    valid_symbols[ENABLE_FLAGS_WITH_X] || valid_symbols[ENABLE_FLAGS_WITHOUT_X]
  ) {
    return python_re_scan_flag_set(lexer, valid_symbols, true);
  }
  if (
    valid_symbols[DISABLE_FLAGS_WITH_X] ||
    valid_symbols[DISABLE_FLAGS_WITHOUT_X]
  ) {
    return python_re_scan_flag_set(lexer, valid_symbols, false);
  }
  if (valid_symbols[CLASS_CHARACTER] || valid_symbols[CLASS_NEGATION]) {
    if (
      valid_symbols[CLASS_NEGATION] &&
      python_re_scan_character(lexer, '^', CLASS_NEGATION)
    ) {
      return true;
    }
    if (lexer->lookahead == '\\') {
      return python_re_scan_escape(lexer, valid_symbols, true);
    }
    if (lexer->lookahead == '-' || lexer->lookahead == ']') {
      return false;
    }
    lexer->advance(lexer, false);
    return python_re_emit(lexer, CLASS_CHARACTER);
  }
  if (
    (valid_symbols[GLOBAL_FLAGS_START] || valid_symbols[SCOPED_FLAGS_START]) &&
    lexer->lookahead == '('
  ) {
    return python_re_scan_flags_start(lexer, valid_symbols);
  }
  if (
    lexer->lookahead ==
    '{' &&
    (valid_symbols[OPEN_BRACE] ||
      valid_symbols[LITERAL_CHARACTER_NORMAL] ||
      valid_symbols[LITERAL_CHARACTER_VERBOSE])
  ) {
    return python_re_scan_brace(lexer, valid_symbols);
  }
  if (lexer->lookahead == '?') {
    uint16_t token = valid_symbols[QUANTIFIER_QUESTION]
      ? QUANTIFIER_QUESTION
      : QUANTIFIER_LAZY_SUFFIX;
    return valid_symbols[token] && python_re_scan_character(lexer, '?', token);
  }
  if (valid_symbols[VERBOSE_COMMENT] && lexer->lookahead == '#') {
    return python_re_scan_comment(lexer, '\n', VERBOSE_COMMENT);
  }
  if (lexer->lookahead == '\\') {
    return python_re_scan_escape(lexer, valid_symbols, false);
  }
  uint16_t token = python_re_literal_token(valid_symbols);
  if (
    !valid_symbols[token] ||
    python_re_is_metacharacter(lexer->lookahead) ||
    (token ==
      LITERAL_CHARACTER_VERBOSE &&
      (python_re_is_whitespace(lexer->lookahead) || lexer->lookahead == '#'))
  ) {
    return false;
  }
  lexer->advance(lexer, false);
  return python_re_emit(lexer, token);
}

#define REGEX_SCANNER(suffix) REGEX_SCANNER_ENTRY(PYTHON_RE_LANGUAGE, suffix)

void *REGEX_SCANNER(create)(void) {
  return NULL;
}

void REGEX_SCANNER(destroy)(void *payload) {
  (void)payload;
}

bool REGEX_SCANNER(scan)(
  void *payload,
  TSLexer *lexer,
  const bool *valid_symbols
) {
  (void)payload;
  return python_re_scan(lexer, valid_symbols);
}

unsigned REGEX_SCANNER(serialize)(void *payload, char *buffer) {
  (void)payload;
  (void)buffer;
  return 0;
}

void REGEX_SCANNER(deserialize)(
  void *payload,
  const char *buffer,
  unsigned length
) {
  (void)payload;
  (void)buffer;
  (void)length;
}

#endif
