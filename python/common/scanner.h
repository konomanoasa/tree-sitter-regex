#ifndef PYTHON_RE_SCANNER_H
#define PYTHON_RE_SCANNER_H

#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifndef PYTHON_RE_LANGUAGE
#error "PYTHON_RE_LANGUAGE must name the generated Tree-sitter language"
#endif

#define REGEX_SCANNER_ENTRY_INNER(language, suffix) \
  tree_sitter_##language##_external_scanner_##suffix
#define REGEX_SCANNER_ENTRY(language, suffix) \
  REGEX_SCANNER_ENTRY_INNER(language, suffix)

#define REGEX_SCANNER(suffix) REGEX_SCANNER_ENTRY(PYTHON_RE_LANGUAGE, suffix)

enum TokenType {
  OPEN_BRACE,
  LITERAL_OPEN_BRACE,
  NUL_CHARACTER,
  ESCAPED_NUL_CHARACTER,
  NUMERIC_ESCAPE_START,
  ERROR_SENTINEL,
};

static void advance(TSLexer *lexer) {
  lexer->advance(lexer, false);
}

static bool is_ascii_digit(int32_t character) {
  return character >= '0' && character <= '9';
}

static bool skip_ascii_digits(TSLexer *lexer) {
  bool found = false;
  while (is_ascii_digit(lexer->lookahead)) {
    found = true;
    advance(lexer);
  }
  return found;
}

static bool emit(TSLexer *lexer, const bool *valid, enum TokenType token) {
  if (!valid[token]) return false;
  lexer->result_symbol = token;
  return true;
}

static bool scan_interval_tail(TSLexer *lexer) {
  bool has_minimum = skip_ascii_digits(lexer);
  if (lexer->lookahead == '}') return has_minimum;
  if (lexer->lookahead != ',') return false;
  advance(lexer);
  skip_ascii_digits(lexer);
  return lexer->lookahead == '}';
}

static bool scan_brace(TSLexer *lexer, const bool *valid) {
  advance(lexer);
  lexer->mark_end(lexer);
  bool complete = scan_interval_tail(lexer);
  return emit(lexer, valid, complete ? OPEN_BRACE : LITERAL_OPEN_BRACE);
}

static bool scan_nul(TSLexer *lexer, enum TokenType token) {
  advance(lexer);
  lexer->mark_end(lexer);
  lexer->result_symbol = token;
  return true;
}

static bool scan_escape(TSLexer *lexer, const bool *valid) {
  advance(lexer);
  if (lexer->eof(lexer)) return false;
  if (lexer->lookahead == 0 && valid[ESCAPED_NUL_CHARACTER])
    return scan_nul(lexer, ESCAPED_NUL_CHARACTER);
  if (!valid[NUMERIC_ESCAPE_START] || !is_ascii_digit(lexer->lookahead))
    return false;
  lexer->mark_end(lexer);
  const int32_t first = lexer->lookahead;
  unsigned count = 0;
  while (count < 3 && lexer->lookahead >= '0' && lexer->lookahead <= '7') {
    count++;
    advance(lexer);
  }
  return (count < 3 || first <= '3') &&
    emit(lexer, valid, NUMERIC_ESCAPE_START);
}

static bool scan(TSLexer *lexer, const bool *valid) {
  if (valid[ERROR_SENTINEL] || lexer->eof(lexer)) return false;
  if (
    lexer->lookahead == '{' && (valid[OPEN_BRACE] || valid[LITERAL_OPEN_BRACE])
  )
    return scan_brace(lexer, valid);
  if (lexer->lookahead == 0 && valid[NUL_CHARACTER])
    return scan_nul(lexer, NUL_CHARACTER);
  if (
    lexer->lookahead == '\\' &&
    (valid[ESCAPED_NUL_CHARACTER] || valid[NUMERIC_ESCAPE_START])
  )
    return scan_escape(lexer, valid);
  return false;
}

void *REGEX_SCANNER(create)(void) {
  return NULL;
}

void REGEX_SCANNER(destroy)(void *payload) {
  (void)payload;
}

bool REGEX_SCANNER(scan)(void *payload, TSLexer *lexer, const bool *valid) {
  (void)payload;
  return scan(lexer, valid);
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
