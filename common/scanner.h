#ifndef REGEX_SCANNER_H
#define REGEX_SCANNER_H

#define REGEX_CONCAT_INNER(left, right) left##right
#define REGEX_CONCAT(left, right) REGEX_CONCAT_INNER(left, right)
#define REGEX_SCANNER_ENTRY(language, suffix) \
  REGEX_CONCAT( \
    REGEX_CONCAT(tree_sitter_, language), \
    REGEX_CONCAT(_external_scanner_, suffix) \
  )

#endif
