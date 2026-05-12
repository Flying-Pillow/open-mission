export type WhereClause = {
    field: string;
    operator?: string | null;
    value: unknown;
};

export type OrderByClause = {
    field: string;
    direction?: 'ASC' | 'DESC' | null;
};

export type SelectQuery = {
    select?: string | null;
    from?: string | null;
    where?: WhereClause | string | Array<WhereClause | string> | null;
    orderBy?: OrderByClause | OrderByClause[] | null;
    group?: string | null;
    limit?: number | null;
    start?: number | null;
    fetch?: string | string[] | null;
};

export type QueryField = {
    name: string;
    compute?: string | null;
    storage?: boolean;
};

export type SelectCompilerOptions = {
    isRecordIdString?: (id: string) => boolean;
    toRecordId?: (id: string) => unknown;
    defaultTable: string;
};

export type CompiledQuery = {
    query: string;
    bindings: Record<string, unknown>;
};

export function compileSelectQuery(
    select: SelectQuery,
    fields: Record<string, QueryField>,
    options: SelectCompilerOptions
): CompiledQuery {
    const bindings: Record<string, unknown> = {};
    let selectClause = select.select || '*';

    if (selectClause.trim() === '*') {
        const runtimeFields = Object.values(fields)
            .filter((field) => !field.storage && field.compute)
            .map((field) => `${field.compute} AS ${field.name}`);

        if (runtimeFields.length > 0) {
            selectClause = `*, ${runtimeFields.join(', ')}`;
        }
    }

    let query = `SELECT ${selectClause}`;
    const whereClauses: string[] = [];

    if (select.from) {
        if (select.from.includes(':')) {
            const tableName = select.from.split(':')[0];
            query += ' FROM type::table($tb)';
            bindings['tb'] = tableName;
            whereClauses.push('id = $id');
            bindings['id'] = coerceRecordId(select.from, options);
        } else if (select.from.startsWith('$')) {
            query += ` FROM ${select.from}`;
        } else {
            query += ' FROM type::table($tb)';
            bindings['tb'] = select.from;
        }
    } else {
        query += ' FROM type::table($tb)';
        bindings['tb'] = options.defaultTable;
    }

    if (select.where) {
        const conditions = Array.isArray(select.where) ? select.where : [select.where];
        conditions.forEach((condition, index) => {
            if (typeof condition === 'string') {
                whereClauses.push(condition);
                return;
            }

            const valueKey = `where_value_${index}`;
            whereClauses.push(`${condition.field} ${condition.operator || '='} $${valueKey}`);
            bindings[valueKey] = coerceWhereValue(condition.value, options);
        });
    }

    if (whereClauses.length > 0) {
        query += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    if (select.orderBy) {
        const orderClauses = (Array.isArray(select.orderBy) ? select.orderBy : [select.orderBy]).map(
            (condition) => `${condition.field} ${condition.direction || 'ASC'}`
        );
        query += ` ORDER BY ${orderClauses.join(', ')}`;
    }
    if (select.group) {
        query += ` GROUP BY ${select.group}`;
    }
    if (select.limit) {
        query += ' LIMIT $limit';
        bindings['limit'] = select.limit;
    }
    if (select.start) {
        query += ' START AT $start';
        bindings['start'] = select.start;
    }
    if (select.fetch) {
        const fetch = Array.isArray(select.fetch) ? select.fetch.join(', ') : select.fetch;
        query += ` FETCH ${fetch}`;
    }

    return { query, bindings };
}

function coerceWhereValue(value: unknown, options: SelectCompilerOptions): unknown {
    if (typeof value === 'string' && options.isRecordIdString?.(value)) {
        return coerceRecordId(value, options);
    }
    return value;
}

function coerceRecordId(id: string, options: SelectCompilerOptions): unknown {
    return options.toRecordId ? options.toRecordId(id) : id;
}