declare function anime(params: Record<string, unknown>): unknown;
declare namespace anime {
  function stagger(delay: number): (el: Element, i: number, total: number) => number;
}
export default anime;
