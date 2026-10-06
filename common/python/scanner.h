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
  OPEN_BRACE,
  LITERAL_OPEN_BRACE,
  NUL_CHARACTER,
  ESCAPED_NUL_CHARACTER,
  ERROR_SENTINEL,
};

static bool python_re_is_ascii_digit(int32_t character) {
  return character >= '0' && character <= '9';
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

static bool python_re_scan_brace(TSLexer *lexer, const bool *valid_symbols) {
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  uint16_t token =
    python_re_scan_interval_tail(lexer) ? OPEN_BRACE : LITERAL_OPEN_BRACE;
  if (!valid_symbols[token]) {
    return false;
  }
  lexer->result_symbol = token;
  return true;
}

static bool python_re_scan(TSLexer *lexer, const bool *valid_symbols) {
  if (valid_symbols[ERROR_SENTINEL] || lexer->eof(lexer)) {
    return false;
  }
  if (
    lexer->lookahead ==
    '{' &&
    (valid_symbols[OPEN_BRACE] || valid_symbols[LITERAL_OPEN_BRACE])
  ) {
    return python_re_scan_brace(lexer, valid_symbols);
  }
  if (lexer->lookahead == 0 && valid_symbols[NUL_CHARACTER]) {
    lexer->result_symbol = NUL_CHARACTER;
  } else if (lexer->lookahead == '\\' && valid_symbols[ESCAPED_NUL_CHARACTER]) {
    lexer->advance(lexer, false);
    if (lexer->eof(lexer) || lexer->lookahead != 0)
      return false;
    lexer->result_symbol = ESCAPED_NUL_CHARACTER;
  } else {
    return false;
  }
  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  return true;
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
