CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    initials TEXT DEFAULT '',
    role TEXT DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    password_change_requested INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    prefix TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS items (
    id SERIAL PRIMARY KEY,
    asset_tag TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL,
    brand TEXT,
    model TEXT,
    serial_number TEXT,
    specifications TEXT,
    purchase_date DATE,
    purchase_price DOUBLE PRECISION,
    vendor TEXT,
    warranty_end DATE,
    status TEXT DEFAULT 'available',
    condition TEXT DEFAULT 'new',
    location TEXT,
    notes TEXT,
    image TEXT,
    qr_code TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    emp_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    department TEXT,
    designation TEXT,
    email TEXT,
    phone TEXT,
    joining_date DATE,
    status TEXT DEFAULT 'active',
    class_teacher TEXT DEFAULT '',
    subject_teacher TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS allocations (
    id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    allocated_date DATE NOT NULL,
    return_date DATE,
    remarks TEXT,
    status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS maintenance (
    id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    issue_date DATE NOT NULL,
    issue_description TEXT,
    vendor TEXT,
    cost DOUBLE PRECISION,
    resolution_date DATE,
    status TEXT DEFAULT 'pending',
    remarks TEXT
);

CREATE TABLE IF NOT EXISTS school_settings (
    id SERIAL PRIMARY KEY,
    school_name TEXT DEFAULT 'My School',
    school_logo TEXT DEFAULT '',
    address TEXT DEFAULT '',
    city TEXT DEFAULT '',
    state TEXT DEFAULT '',
    pincode TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    sub_heading TEXT DEFAULT '',
    academic_session TEXT DEFAULT '',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_allocations_item_id ON allocations(item_id);
CREATE INDEX IF NOT EXISTS idx_allocations_employee_id ON allocations(employee_id);
CREATE INDEX IF NOT EXISTS idx_allocations_status ON allocations(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_item_id ON maintenance(item_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_status ON maintenance(status);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_asset_tag ON items(asset_tag);
CREATE INDEX IF NOT EXISTS idx_items_warranty_end ON items(warranty_end);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_emp_id ON employees(emp_id);
CREATE INDEX IF NOT EXISTS idx_employees_name ON employees(name);
CREATE INDEX IF NOT EXISTS idx_items_brand ON items(brand);
CREATE INDEX IF NOT EXISTS idx_items_model ON items(model);
CREATE INDEX IF NOT EXISTS idx_items_serial_number ON items(serial_number);
CREATE INDEX IF NOT EXISTS idx_allocations_allocated_date ON allocations(allocated_date);