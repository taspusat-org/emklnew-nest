declare module 'pdf-to-printer' {
  interface Printer {
    name: string;
    // Tambahkan properti lain jika diperlukan, berdasarkan dokumentasi pdf-to-printer
  }

  interface PrintOptions {
    printer?: string;
    pages?: string;
    subset?: 'odd' | 'even';
    orientation?: string;
    scale?: 'noscale' | 'shrink' | 'fit';
    monochrome?: boolean;
    side?: 'duplex' | 'duplexshort' | 'duplexlong' | 'simplex';
    bin?: string;
    paperSize?: string;
    silent?: boolean;
    printDialog?: boolean;
    copies?: number;
  }

  export function print(pdfPath: string, options?: PrintOptions): Promise<void>;
  export function getPrinters(): Promise<Printer[]>;
  export function getDefaultPrinter(): Promise<Printer | null>;
}
