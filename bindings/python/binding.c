#include <Python.h>

#include "tree_sitter/parser.h"

const TSLanguage *tree_sitter_ecmaregex(void);
const TSLanguage *tree_sitter_ecmaregex_u(void);
const TSLanguage *tree_sitter_ecmaregex_v(void);
const TSLanguage *tree_sitter_pcre2(void);
const TSLanguage *tree_sitter_posix_bre(void);
const TSLanguage *tree_sitter_posix_ere(void);
const TSLanguage *tree_sitter_pyregex(void);
const TSLanguage *tree_sitter_pyregex_verbose(void);

static PyObject *language_ecmaregex(PyObject *self, PyObject *args) {
  (void)self;
  (void)args;
  return PyCapsule_New(
    (void *)tree_sitter_ecmaregex(),
    "tree_sitter.Language",
    NULL
  );
}

static PyObject *language_ecmaregex_u(PyObject *self, PyObject *args) {
  (void)self;
  (void)args;
  return PyCapsule_New(
    (void *)tree_sitter_ecmaregex_u(),
    "tree_sitter.Language",
    NULL
  );
}

static PyObject *language_ecmaregex_v(PyObject *self, PyObject *args) {
  (void)self;
  (void)args;
  return PyCapsule_New(
    (void *)tree_sitter_ecmaregex_v(),
    "tree_sitter.Language",
    NULL
  );
}

static PyObject *language_pcre2(PyObject *self, PyObject *args) {
  (void)self;
  (void)args;
  return PyCapsule_New(
    (void *)tree_sitter_pcre2(),
    "tree_sitter.Language",
    NULL
  );
}

static PyObject *language_posix_bre(PyObject *self, PyObject *args) {
  (void)self;
  (void)args;
  return PyCapsule_New(
    (void *)tree_sitter_posix_bre(),
    "tree_sitter.Language",
    NULL
  );
}

static PyObject *language_posix_ere(PyObject *self, PyObject *args) {
  (void)self;
  (void)args;
  return PyCapsule_New(
    (void *)tree_sitter_posix_ere(),
    "tree_sitter.Language",
    NULL
  );
}

static PyObject *language_pyregex(PyObject *self, PyObject *args) {
  (void)self;
  (void)args;
  return PyCapsule_New(
    (void *)tree_sitter_pyregex(),
    "tree_sitter.Language",
    NULL
  );
}

static PyObject *language_pyregex_verbose(PyObject *self, PyObject *args) {
  (void)self;
  (void)args;
  return PyCapsule_New(
    (void *)tree_sitter_pyregex_verbose(),
    "tree_sitter.Language",
    NULL
  );
}

static PyMethodDef methods[] = {
  {"language_ecmaregex",
    language_ecmaregex,
    METH_NOARGS,
    "Return the ecmaregex language capsule."},
  {"language_ecmaregex_u",
    language_ecmaregex_u,
    METH_NOARGS,
    "Return the ecmaregex_u language capsule."},
  {"language_ecmaregex_v",
    language_ecmaregex_v,
    METH_NOARGS,
    "Return the ecmaregex_v language capsule."},
  {"language_pcre2",
    language_pcre2,
    METH_NOARGS,
    "Return the pcre2 language capsule."},
  {"language_posix_bre",
    language_posix_bre,
    METH_NOARGS,
    "Return the posix_bre language capsule."},
  {"language_posix_ere",
    language_posix_ere,
    METH_NOARGS,
    "Return the posix_ere language capsule."},
  {"language_pyregex",
    language_pyregex,
    METH_NOARGS,
    "Return the pyregex language capsule."},
  {"language_pyregex_verbose",
    language_pyregex_verbose,
    METH_NOARGS,
    "Return the pyregex_verbose language capsule."},
  {NULL, NULL, 0, NULL},
};

static struct PyModuleDef module = {
  PyModuleDef_HEAD_INIT,
  .m_name = "binding",
  .m_size = -1,
  .m_methods = methods,
};

PyMODINIT_FUNC PyInit_binding(void) {
  return PyModule_Create(&module);
}
