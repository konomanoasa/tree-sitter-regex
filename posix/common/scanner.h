#ifndef POSIX_REGEX_SCANNER_H
#define POSIX_REGEX_SCANNER_H

#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifndef POSIX_REGEX_MODE
#error "POSIX_REGEX_MODE must select the POSIX regular-expression dialect"
#endif

#if POSIX_REGEX_MODE == 0
#define POSIX_REGEX_LANGUAGE posix_bre
#elif POSIX_REGEX_MODE == 1
#define POSIX_REGEX_LANGUAGE posix_ere
#else
#error "POSIX_REGEX_MODE must be 0 for BRE or 1 for ERE"
#endif

#define REGEX_SCANNER_ENTRY_INNER(language, suffix) \
  tree_sitter_##language##_external_scanner_##suffix
#define REGEX_SCANNER_ENTRY(language, suffix) \
  REGEX_SCANNER_ENTRY_INNER(language, suffix)

#define REGEX_SCANNER(suffix) REGEX_SCANNER_ENTRY(POSIX_REGEX_LANGUAGE, suffix)

enum TokenType {
  COLLATING_SYMBOL_SINGLE,
  COLLATING_SYMBOL_MULTI,
  COLLATING_SYMBOL_META,
  EQUIVALENCE_CLASS_SINGLE,
  EQUIVALENCE_CLASS_MULTI,
  BRACKET_OPEN_CHARACTER,
  TRAILING_BRACKET_HYPHEN,
#if POSIX_REGEX_MODE == 0
  BRE_RIGHT_ANCHOR,
#endif
  ERROR_SENTINEL,
};

typedef struct {
  int32_t terminator;
  enum TokenType single;
  enum TokenType multi;
  enum TokenType meta;
} Compound;

static const Compound collating_symbol = {
  '.',
  COLLATING_SYMBOL_SINGLE,
  COLLATING_SYMBOL_MULTI,
  COLLATING_SYMBOL_META,
};

static const Compound equivalence_class = {
  '=',
  EQUIVALENCE_CLASS_SINGLE,
  EQUIVALENCE_CLASS_MULTI,
  EQUIVALENCE_CLASS_SINGLE,
};

static void advance(TSLexer *lexer) {
  lexer->advance(lexer, false);
}

static bool is_meta_character(int32_t character) {
  return character == '^' || character == '-' || character == ']';
}

static bool emit(TSLexer *lexer, const bool *valid, enum TokenType token) {
  if (!valid[token]) return false;
  lexer->result_symbol = token;
  return true;
}

static bool expects_payload(const bool *valid, const Compound *compound) {
  return valid[compound->single] ||
    valid[compound->multi] ||
    valid[compound->meta];
}

// Declining at EOF makes later openers rescan the same suffix.
static bool
scan_payload(TSLexer *lexer, const bool *valid, const Compound *compound) {
  uint32_t count = 0;
  int32_t first = 0;
  lexer->mark_end(lexer);
  while (!lexer->eof(lexer)) {
    int32_t character = lexer->lookahead;
    advance(lexer);
    if (character == compound->terminator && lexer->lookahead == ']') break;
    if (count == 0) first = character;
    count += 1;
    lexer->mark_end(lexer);
  }
  if (count == 0) return false;
  enum TokenType token = compound->single;
  if (count > 1) token = compound->multi;
  else if (is_meta_character(first)) token = compound->meta;
  return emit(lexer, valid, token);
}

static bool scan_bracket_open_character(TSLexer *lexer) {
  advance(lexer);
  int32_t next = lexer->lookahead;
  if (next == '.' || next == '=' || next == ':') return false;
  lexer->result_symbol = BRACKET_OPEN_CHARACTER;
  return true;
}

static bool scan_trailing_hyphen(TSLexer *lexer) {
  advance(lexer);
  lexer->mark_end(lexer);
  if (lexer->lookahead != ']') return false;
  lexer->result_symbol = TRAILING_BRACKET_HYPHEN;
  return true;
}

#if POSIX_REGEX_MODE == 0
static bool scan_right_anchor(TSLexer *lexer) {
  advance(lexer);
  lexer->mark_end(lexer);
  if (!lexer->eof(lexer)) return false;
  lexer->result_symbol = BRE_RIGHT_ANCHOR;
  return true;
}
#endif

static bool scan(TSLexer *lexer, const bool *valid) {
  if (valid[ERROR_SENTINEL] || lexer->eof(lexer)) return false;
  if (valid[BRACKET_OPEN_CHARACTER] && lexer->lookahead == '[')
    return scan_bracket_open_character(lexer);
  if (valid[TRAILING_BRACKET_HYPHEN] && lexer->lookahead == '-')
    return scan_trailing_hyphen(lexer);
#if POSIX_REGEX_MODE == 0
  if (valid[BRE_RIGHT_ANCHOR] && lexer->lookahead == '$')
    return scan_right_anchor(lexer);
#endif
  if (expects_payload(valid, &collating_symbol))
    return scan_payload(lexer, valid, &collating_symbol);
  if (expects_payload(valid, &equivalence_class))
    return scan_payload(lexer, valid, &equivalence_class);
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
