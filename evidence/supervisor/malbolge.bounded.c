/* Interpreter for Malbolge.                                          */
/* '98 Ben Olmstead.                                                  */
/*                                                                    */
/* Malbolge is the name of Dante's Eighth circle of Hell.  This       */
/* interpreter isn't even Copylefted; I hereby place it in the public */
/* domain.  Have fun...                                               */
/*                                                                    */
/* Note: in keeping with the idea that programming in Malbolge is     */
/* meant to be hell, there is no debugger.                            */
/*                                                                    */
/* By the way, this code assumes that short is 16 bits.  I haven't    */
/* seen any case where it isn't, but it might happen.  If short is    */
/* longer than 16 bits, it will still work, though it will take up    */
/* considerably more memory.                                          */
/*                                                                    */
/* If you are compiling with a 16-bit Intel compiler, you will need   */
/* >64K data arrays; this means using the HUGE memory model on most   */
/* compilers, but MS C, as of 8.00, possibly earlier as well, allows  */
/* you to specify a custom memory-model; the best model to choose in  */
/* this case is /Ashd (near code, huge data), I think.                */

#include <stdio.h>
#include <stdlib.h>
#include <ctype.h>
#include <string.h>

#ifdef __GNUC__
static inline
#endif
void exec( unsigned short *mem );

#ifdef __GNUC__
static inline
#endif
unsigned short op( unsigned short x, unsigned short y );

const char xlat1[] =
  "+b(29e*j1VMEKLyC})8&m#~W>qxdRp0wkrUo[D7,XTcA\"lI"
  ".v%{gJh4G\\-=O@5`_3i<?Z';FNQuY]szf$!BS/|t:Pn6^Ha";

const char xlat2[] =
  "5z]&gqtyfr$(we4{WP)H-Zn,[%\\3dL+Q;>U!pJS72FhOA1C"
  "B6v^=I_0/8|jsb9m<.TVac`uY*MK'X~xDl}REokN:#?G\"i@";


/* Supervisor-only instrumentation; not included in the product. */
static FILE *sup_trace;
static unsigned long sup_steps;
static unsigned sup_order;
static void sup_dump(const char *envkey, unsigned short *mem) {
  const char *path = getenv(envkey);
  if (path) {
    FILE *f = fopen(path, "wb");
    if (!f || fwrite(mem, sizeof(unsigned short), 59049, f) != 59049) exit(72);
    fclose(f);
  }
}
static unsigned short sup_read(unsigned short *mem, unsigned short address) {
  fprintf(sup_trace, "{\"kind\":\"read\",\"role\":\"data-read\",\"order\":%u,\"address\":%u,\"value\":%u}\n", sup_order++, address, mem[address]);
  return mem[address];
}
static void sup_write(const char *role, unsigned short address, unsigned short before, unsigned short after) {
  fprintf(sup_trace, "{\"kind\":\"write\",\"role\":\"%s\",\"order\":%u,\"address\":%u,\"before\":%u,\"after\":%u}\n", role, sup_order++, address, before, after);
}
static void sup_end(unsigned short a, unsigned short c, unsigned short d, int halted) {
  fprintf(sup_trace, "{\"kind\":\"after\",\"step\":%lu,\"a\":%u,\"c\":%u,\"d\":%u,\"halted\":%s}\n", ++sup_steps, a,c,d,halted ? "true" : "false");
}
static void sup_finish(unsigned short *mem, const char *status) {
  fprintf(sup_trace, "{\"kind\":\"terminal\",\"status\":\"%s\",\"step\":%lu}\n", status,sup_steps);
  sup_dump("BOLGE_SUPERVISOR_FINAL", mem);
  fclose(sup_trace);
}

int main( int argc, char **argv )
{
  FILE *f;
  unsigned short i = 0, j;
  int x;
  unsigned short *mem;
  if ( argc != 2 )
  {
    fputs( "invalid command line\n", stderr );
    return ( 1 );
  }
  if ( ( f = fopen( argv[1], "r" ) ) == NULL )
  {
    fputs( "can't open file\n", stderr );
    return ( 1 );
  }
#ifdef _MSC_VER
  mem = (unsigned short *)_halloc( 59049, sizeof(unsigned short) );
#else
  mem = (unsigned short *)malloc( sizeof(unsigned short) * 59049 );
#endif
  if ( mem == NULL )
  {
    fclose( f );
    fputs( "can't allocate memory\n", stderr );
    return ( 1 );
  }
  while ( ( x = getc( f ) ) != EOF )
  {
    if ( isspace( x ) ) continue;
    if ( x < 127 && x > 32 )
    {
      if ( strchr( "ji*p</vo", xlat1[( x - 33 + i ) % 94] ) == NULL )
      {
        fputs( "invalid character in source file\n", stderr );
        free( mem );
        fclose( f );
        return ( 1 );
      }
    }
    if ( i == 59049 )
    {
      fputs( "input file too long\n", stderr );
      free( mem );
      fclose( f );
      return ( 1 );
    }
    mem[i++] = x;
  }
  fclose( f );
  while ( i < 59049 ) mem[i] = op( mem[i - 1], mem[i - 2] ), i++;
  exec( mem );
  free( mem );
  return ( 0 );
}

#ifdef __GNUC__
static inline
#endif
void exec( unsigned short *mem )
{
  unsigned short a = 0, c = 0, d = 0;
  int x;
  const char *trace_path = getenv("BOLGE_SUPERVISOR_TRACE");
  if (!trace_path || !(sup_trace = fopen(trace_path, "wb"))) exit(71);
  sup_steps = 0;
  fprintf(sup_trace, "{\"kind\":\"tables\",\"xlat1Size\":%zu,\"xlat2Size\":%zu,\"xlat2_94\":%u,\"wordSize\":%zu}\n", sizeof(xlat1),sizeof(xlat2),(unsigned char)xlat2[94],sizeof(unsigned short));
  sup_dump("BOLGE_SUPERVISOR_INITIAL", mem);
  for (;;)
  {
    if (sup_steps >= 1000) { sup_finish(mem,"BUDGET"); return; }
    if ( mem[c] < 33 || mem[c] > 126 ) { sup_finish(mem,"STALLED_INVALID_FETCH"); return; }
    sup_order = 0;
    fprintf(sup_trace, "{\"kind\":\"before\",\"step\":%lu,\"a\":%u,\"c\":%u,\"d\":%u,\"raw\":%u,\"decoded\":%u}\n",sup_steps,a,c,d,mem[c],(unsigned char)xlat1[(mem[c]-33+c)%94]);
    fprintf(sup_trace, "{\"kind\":\"read\",\"role\":\"fetch\",\"order\":%u,\"address\":%u,\"value\":%u}\n", sup_order++,c,mem[c]);
    switch ( xlat1[( mem[c] - 33 + c ) % 94] )
    {
      case 'j': d = sup_read(mem,d); break;
      case 'i': c = sup_read(mem,d); break;
      case '*': { unsigned short old = sup_read(mem,d); a = mem[d] = old / 3 + old % 3 * 19683; sup_write("data-write",d,old,mem[d]); break; }
      case 'p': { unsigned short old = sup_read(mem,d); a = mem[d] = op(a,old); sup_write("data-write",d,old,mem[d]); break; }
      case '<':
#if '\n' != 10
        if ( x == 10 ) putc( '\n', stdout ); else
#endif
        putc( a, stdout );
        fprintf(sup_trace, "{\"kind\":\"output\",\"byte\":%u}\n", (unsigned char)a);
        break;
      case '/':
        x = getc( stdin );
#if '\n' != 10
        if ( x == '\n' ) a = 10; else
#endif
        if ( x == EOF ) a = 59048; else a = x;
        fprintf(sup_trace, "{\"kind\":\"input\",\"value\":%d,\"eof\":%s}\n",x,x==EOF ? "true":"false");
        break;
      case 'v': sup_end(a,c,d,1); sup_finish(mem,"HALTED"); return;
    }
    if (mem[c] < 33 || mem[c] > 127) { sup_finish(mem,"REFERENCE_UNDEFINED"); return; }
    { unsigned short old = mem[c]; mem[c] = xlat2[mem[c] - 33]; sup_write("encryption",c,old,mem[c]); }
    if ( c == 59048 ) c = 0; else c++;
    if ( d == 59048 ) d = 0; else d++;
    sup_end(a,c,d,0);
  }
}

#ifdef __GNUC__
static inline
#endif
unsigned short op( unsigned short x, unsigned short y )
{
  unsigned short i = 0, j;
  static const unsigned short p9[5] =
    { 1, 9, 81, 729, 6561 };
  static const unsigned short o[9][9] =
    {
      { 4, 3, 3, 1, 0, 0, 1, 0, 0 },
      { 4, 3, 5, 1, 0, 2, 1, 0, 2 },
      { 5, 5, 4, 2, 2, 1, 2, 2, 1 },
      { 4, 3, 3, 1, 0, 0, 7, 6, 6 },
      { 4, 3, 5, 1, 0, 2, 7, 6, 8 },
      { 5, 5, 4, 2, 2, 1, 8, 8, 7 },
      { 7, 6, 6, 7, 6, 6, 4, 3, 3 },
      { 7, 6, 8, 7, 6, 8, 4, 3, 5 },
      { 8, 8, 7, 8, 8, 7, 5, 5, 4 },
    };
  for ( j = 0; j < 5; j++ )
    i += o[y / p9[j] % 9][x / p9[j] % 9] * p9[j];
  return ( i );
}
