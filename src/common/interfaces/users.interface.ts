export interface Users {
  id: string; // "bigint" biasanya disimpan sebagai string di JavaScript
  username: string; // "nvarchar" => string
  name: string; // "nvarchar" => string
  email: string; // "nvarchar" => string
  statusaktif: number; // "bigint" => number
  modifiedby: string; // "nvarchar" => string
  created_at: string; // "datetime2" => string
  updated_at: string; // "datetime2" => string
}
