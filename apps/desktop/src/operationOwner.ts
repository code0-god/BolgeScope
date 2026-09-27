export class OperationOwner {
  private generation = 0;

  begin(): number {
    return ++this.generation;
  }

  owns(operation: number): boolean {
    return operation === this.generation;
  }

  invalidate(): void {
    this.generation++;
  }
}
