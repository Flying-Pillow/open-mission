import { z } from 'zod/v4';
import { defineModel, field, table, type SurrealFieldMetadata, type ZodSurrealModelDefinition } from '../../src/index.js';

const text = (type: string, metadata: SurrealFieldMetadata = {}) => z.unknown().register(field, { type, ...metadata });
const timestampFields = {
    time: text('object'),
    'time.created_at': text('datetime', { default: 'time::now()' }),
    'time.updated_at': text('datetime', { value: 'time::now()' })
};

const ReviewSchema = z.object({
    id: text('string'),
    rating: text('number', { assertion: '$value > 0 AND $value < 6' }),
    review_text: text('string'),
    ...timestampFields
}).strict().register(table, {
    table: 'review',
    kind: 'relation',
    from: 'person',
    to: 'product',
    schemafull: true,
    permissions: 'none',
    analyzers: [{ name: 'blank_snowball', tokenizers: ['blank'], filters: ['lowercase', 'snowball(english)'] }],
    indexes: [{ name: 'review_content', fields: ['review_text'], fulltext: { analyzer: 'blank_snowball', bm25: true, highlights: true } }]
});

const OrderSchema = z.object({
    product_name: text('string'),
    currency: text('string'),
    price: text('number'),
    quantity: text('number'),
    colour: text('string'),
    size: text('string'),
    shipping_address: text('object', { flexible: true }),
    payment_method: text('string'),
    order_status: text('string'),
    id: text('string'),
    ...timestampFields,
    'time.processed_at': text('option<datetime>'),
    'time.shipped_at': text('option<datetime>')
}).strict().register(table, {
    table: 'order',
    kind: 'relation',
    from: 'person',
    to: 'product',
    schemafull: true,
    permissions: 'none',
    indexes: [
        { name: 'order_count', fields: ['order_status', 'time.created_at'] },
        { name: 'order_product', fields: ['product_name'] }
    ]
});

const AvgProductReviewSchema = z.object({
    avg_review: text('number'),
    id: text('string'),
    number_of_reviews: text('number'),
    product_id: text('array<record<product>>'),
    product_name: text('array<string>')
}).strict().register(table, {
    table: 'avg_product_review',
    schemafull: true,
    as: 'SELECT count() AS number_of_reviews, math::mean(<float> rating) AS avg_review, ->product.id AS product_id, ->product.name AS product_name FROM review GROUP BY product_id, product_name'
});

const MonthlySalesSchema = z.object({
    id: text('string'),
    currency: text('string'),
    month: text('string'),
    number_of_orders: text('number'),
    sum_sales: text('number')
}).strict().register(table, {
    table: 'monthly_sales',
    schemafull: true,
    as: "SELECT count() AS number_of_orders, time::format(time.created_at, '%Y-%m') AS month, math::sum(price * quantity) AS sum_sales, currency FROM order GROUP BY month, currency"
});

const AddressHistorySchema = z.object({
    id: text('string'),
    person: text('record<person>', { reference: 'person' }),
    addresses: text('array<object>'),
    'addresses.*.address_line_1': text('string'),
    'addresses.*.address_line_2': text('option<string>'),
    'addresses.*.city': text('string'),
    'addresses.*.coordinates': text('geometry<point>'),
    'addresses.*.country': text('string'),
    'addresses.*.post_code': text('string'),
    ...timestampFields
}).strict().register(table, {
    table: 'address_history',
    schemafull: true,
    permissions: 'none'
});

const PaymentDetailsSchema = z.object({
    id: text('string'),
    person: text('record<person>', { reference: 'person' }),
    stored_cards: text('array<object>'),
    ...timestampFields
}).strict().register(table, {
    table: 'payment_details',
    omitSchemaMode: true,
    permissions: 'none'
});

const PersonSchema = z.object({
    id: text('string'),
    first_name: text('string'),
    last_name: text('string'),
    name: text('string'),
    company_name: text('option<string>'),
    email: text('string', { assertion: 'string::is_email($value)' }),
    phone: text('string'),
    address: text('object', { flexible: true }),
    ...timestampFields
}).strict().register(table, {
    table: 'person',
    schemafull: true,
    permissions: 'none',
    indexes: [{ name: 'person_country', fields: ['address.country'] }]
});

const ProductSchema = z.object({
    id: text('string'),
    name: text('string'),
    details: text('array<string>'),
    category: text('string'),
    sub_category: text('string'),
    colours: text('array<string>'),
    sizes: text('array<string>'),
    price: text('number'),
    currency: text('string'),
    images: text('array<object>'),
    'images.*.url': text('string', { assertion: 'string::is_url($value)' }),
    'images.*.position': text('number'),
    seller: text('record<seller>'),
    ...timestampFields
}).strict().register(table, {
    table: 'product',
    schemafull: true,
    permissions: 'none'
});

const ProductSkuSchema = z.object({
    id: text('string'),
    quantity: text('number'),
    colour: text('string'),
    size: text('string'),
    ...timestampFields
}).strict().register(table, {
    table: 'product_sku',
    kind: 'relation',
    from: 'product',
    to: 'product',
    schemafull: true,
    permissions: 'none'
});

const WishlistSchema = z.object({
    id: text('string'),
    time: text('object'),
    colour: text('string'),
    size: text('string'),
    'time.created_at': text('datetime', { default: 'time::now()' }),
    'time.deleted_at': text('option<datetime>')
}).strict().register(table, {
    table: 'wishlist',
    kind: 'relation',
    from: 'person',
    to: 'product',
    schemafull: true,
    permissions: 'none',
    indexes: [{ name: 'unique_wishlist_relationships', fields: ['in', 'out'], unique: true }]
});

const CartSchema = z.object({
    id: text('string'),
    product_name: text('string'),
    currency: text('string'),
    price: text('number'),
    quantity: text('number'),
    colour: text('string'),
    size: text('string'),
    ...timestampFields
}).strict().register(table, {
    table: 'cart',
    kind: 'relation',
    from: 'person',
    to: 'product',
    schemafull: true,
    permissions: 'none'
});

const SellerSchema = z.object({
    id: text('string'),
    name: text('string'),
    addresses: text('object', { flexible: true }),
    website: text('object'),
    'website.main': text('string'),
    'website.docs': text('string'),
    'website.store': text('string'),
    email: text('string'),
    ...timestampFields
}).strict().register(table, {
    table: 'seller',
    schemafull: true,
    permissions: 'none'
});

export const surrealDealStoreModels: ZodSurrealModelDefinition[] = [
    defineModel({ name: 'Review', schema: ReviewSchema }),
    defineModel({ name: 'Order', schema: OrderSchema }),
    defineModel({ name: 'AvgProductReview', schema: AvgProductReviewSchema }),
    defineModel({ name: 'MonthlySales', schema: MonthlySalesSchema }),
    defineModel({ name: 'AddressHistory', schema: AddressHistorySchema }),
    defineModel({ name: 'PaymentDetails', schema: PaymentDetailsSchema }),
    defineModel({ name: 'Person', schema: PersonSchema }),
    defineModel({ name: 'Product', schema: ProductSchema }),
    defineModel({ name: 'ProductSku', schema: ProductSkuSchema }),
    defineModel({ name: 'Wishlist', schema: WishlistSchema }),
    defineModel({ name: 'Cart', schema: CartSchema }),
    defineModel({ name: 'Seller', schema: SellerSchema })
];