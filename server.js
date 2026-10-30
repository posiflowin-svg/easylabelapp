require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const adminSecurity = require('./middleware/adminSecurity');

const AuthRoute = require('./routes/auth');
const TemplateRoute = require('./routes/template');
const AppVersionRoute = require('./routes/appversion');
const ShowADRoute = require('./routes/showad');
const BannerRoutes = require('./routes/banner');
const OrderRoutes = require('./routes/order');
const couponRoutes = require('./routes/coupon');
const productRoutes = require('./routes/productRoutes');
const colorRoutes = require('./routes/colorRoutes');
const walletUserRoutes = require('./routes/walletUserRoutes');
const walletTransactionRoutes = require('./routes/walletTransactionRoutes');
const userTemplateRoutes = require('./routes/userTemplateRoutes');
const PremiumRoute = require('./routes/premium');
const BillingRoute = require('./routes/billing');
const NotificationsApiRoute = require('./routes/notificationsApi');
const AIRoute = require('./routes/ai');
const BorderRoute = require('./routes/border');
const IconLibraryRoute = require('./routes/iconLibrary');
const IconLibraryController = require('./controllers/IconLibraryController');
const UsageAnalyticsRoute = require('./routes/usageAnalytics');
const CloudBackupRoute = require('./routes/cloudBackup');
const BorderController = require('./controllers/BorderController');
const PremiumController = require('./controllers/PremiumController');
const ProductController = require('./controllers/productController');
const AccountDeletionController = require('./controllers/AccountDeletionController');
const AccountDeletionRoute = require('./routes/accountDeletion');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const walletUserController = require('./controllers/walletUserController');
const notificationScheduler = require('./services/notificationScheduler');

mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection;
db.on('error', (err) => {
    console.log(err);
});

db.once('open', () => {
    console.log('DB Connection Success');
});

const app = express();
app.disable('x-powered-by');
app.use((req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','strict-origin-when-cross-origin');res.set('X-Frame-Options','DENY');next();});
// Render terminates HTTPS at its reverse proxy. Trust its forwarded protocol
// so secure session cookies can be issued and returned correctly.
app.set('trust proxy', 1);

// Add session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || (() => { throw new Error('Set SESSION_SECRET in Render environment before starting server'); })(),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 8 * 60 * 60 * 1000 }
}));

app.use(morgan('dev'));
app.post('/api/order/payment/webhook', express.raw({type:'application/json',limit:'256kb'}), require('./routes/razorpayWebhook'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: process.env.JSON_BODY_LIMIT || '15mb' }));
// Border files uploaded from the admin are persisted in MongoDB.
// Keep the same public URL used by existing Android builds.
app.get('/border-assets/:filename', BorderController.assetFile);

// Static fallback remains for any border assets that are packaged with the source.
app.use('/border-assets', express.static(path.join(__dirname, 'public', 'border-assets')));
app.use('/template-assets-v2', express.static(path.join(__dirname, 'public', 'template-assets-v2')));


// Set the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes
app.get('/admin-login', (req,res)=>{res.set('Cache-Control','no-store');res.status(200).sendFile(path.join(__dirname,'public','admin-login.html'));});
app.post('/api/admin-logout',adminSecurity.requireAdmin,(req,res)=>req.session.destroy(()=>{res.clearCookie('connect.sid');res.json({success:true});}));
app.get('/', adminSecurity.adminPage, (req, res) => {
    res.render('index');
});

app.get('/orderspage', adminSecurity.adminPage, (req, res) => {
    res.render('orders');
});

app.get('/coupons', adminSecurity.adminPage, (req, res) => {
    res.render('coupon');
});

app.get('/users', adminSecurity.adminPage, (req, res) => {
    res.render('users');
});

// Public Google Play account deletion page. No admin session or app login is required
// to open it; the request itself is verified using the user's EasyLabel password.
app.get('/delete-account', AccountDeletionController.page);
app.post('/delete-account', AccountDeletionController.submit);

app.get('/sells_users', adminSecurity.adminPage, (req, res) => {
    res.render('sells_users');
});

app.get('/premium-management', adminSecurity.adminPage, PremiumController.page);
app.get('/shop-management', adminSecurity.adminPage, ProductController.page);
app.get('/border-management', adminSecurity.adminPage, BorderController.page);
app.get('/icon-library', adminSecurity.adminPage, IconLibraryController.page);
app.get('/icon-assets/:categoryId/:iconId', IconLibraryController.asset);
app.get('/api/usage/customer-detail', adminSecurity.requireAdmin, require('./controllers/UsageAnalyticsController').customerDetail);
app.get('/usage-analytics', adminSecurity.adminPage, require('./controllers/UsageAnalyticsController').page);
// Report whether targeting authentication has been configured (no secrets exposed).
app.get('/api/targeting-auth/status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ configured: !!(process.env.ADMIN_PASSWORD || process.env.POS_ENQUIRY_ADMIN_PASSWORD), authenticated: !!req.session?.adminAuthenticated });
});
// Add the password verification route directly to app
app.post('/api/verify-admin-password', adminSecurity.loginLimiter, (req, res) => {
    const requestId = require('crypto').randomBytes(4).toString('hex');
    res.set('X-Request-ID', requestId);
    res.once('finish', () => console.info('[ADMIN_LOGIN]', requestId, 'status=' + res.statusCode));
    res.once('close', () => { if (!res.writableEnded) console.warn('[ADMIN_LOGIN]', requestId, 'connection closed before response'); });
    const reply = (status, payload) => {
        if (res.headersSent || res.writableEnded || res.destroyed) {
            console.error('[ADMIN_LOGIN]', requestId, 'duplicate response suppressed');
            return;
        }
        return res.status(status).json(payload);
    };
    res.set('Cache-Control', 'no-store');
    const { password } = req.body || {};
    if (typeof password !== 'string' || !password.length) return reply(400,{success:false,code:'PASSWORD_REQUIRED',message:'Enter your administrator password.'});
    
    const configuredPassword = process.env.ADMIN_PASSWORD || process.env.POS_ENQUIRY_ADMIN_PASSWORD;
    if (!configuredPassword) return reply(503,{ success: false, code: 'ADMIN_NOT_CONFIGURED', message: 'Admin verification is not configured. Set ADMIN_PASSWORD in Render environment variables and redeploy.' });
    const valid = adminSecurity.comparePassword(password,configuredPassword);
    if (valid) {
        req.session.regenerate((regenError) => {
        if (regenError) { console.error('[ADMIN_LOGIN] Session regeneration failed:', regenError.message); return reply(500,{success:false,code:'SESSION_REGENERATE_FAILED',message:'Unable to start admin session. Check server logs.'}); }
        req.session.adminAuthenticated = true;
        return req.session.save((error) => {
            if (error) { console.error('[ADMIN_LOGIN] Session save failed:', error.message); return reply(500,{ success: false, code:'SESSION_SAVE_FAILED', message: 'Unable to save admin session. Check server logs.' }); }
            return reply(200,{ success: true, redirect: '/' });
        });
        });
    }
    
    return reply(401,{ success: false, message: 'Incorrect administrator password.' });
});

// Enforce admin authorization BEFORE mounting existing routes.
app.use(adminSecurity.apiPolicy);

// Mount other routes
app.use('/api/template-bulk', require('./routes/templateBulk'));
app.use('/api/template', TemplateRoute);
app.use('/api/appversion', AppVersionRoute);
app.use('/api/showad', ShowADRoute);
app.use('/api', AuthRoute);
app.use('/api/shopping', BannerRoutes);
app.use('/api/order', OrderRoutes);
app.use('/api/admin/payment-exceptions', require('./routes/paymentExceptions'));
app.use('/api/coupon', couponRoutes);
app.use('/api/products', productRoutes);
app.use('/api/pos-enquiries', require('./routes/posEnquiries'));
app.use('/api/colors', colorRoutes);
app.use('/api/walletuser', walletUserRoutes);
app.use('/api/wallettransaction', walletTransactionRoutes);
app.use('/api/user-templates', userTemplateRoutes);
app.use('/api/premium', PremiumRoute);
app.use('/api/billing/google', BillingRoute);
app.use('/api/notifications', NotificationsApiRoute);
app.use('/api/ai', AIRoute);
app.use('/api/borders', BorderRoute);
app.use('/api/icon-library', IconLibraryRoute);
app.use('/api/usage', UsageAnalyticsRoute);
app.use('/api/targeting', require('./routes/targeting'));
app.use('/api/campaign-customer', require('./routes/campaignCustomer'));
app.use('/api/cloud-backup', CloudBackupRoute);
app.use('/api/account-deletion', AccountDeletionRoute);

// Import users CSV route
app.post('/api/import-users', adminSecurity.requireAdmin, upload.single('file'), walletUserController.importUsers);

// Log full stack and avoid sending a second response when headers are already sent.
app.use((err, req, res, next) => {
    console.error('[HTTP_ERROR]', req.method, req.originalUrl.split('?')[0], err && err.stack || err);
    if (res.headersSent || res.writableEnded || res.destroyed) return next(err);
    return res.status(500).json({success:false,code:'INTERNAL_SERVER_ERROR',message:'An internal server error occurred.'});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('Server is running on port ' + PORT);
    notificationScheduler.start();
});