<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\SaleController;
use App\Http\Controllers\Api\SettingController;
use App\Http\Controllers\Api\StockMovementController;
use App\Http\Controllers\Api\UserController;
use Illuminate\Support\Facades\Route;

Route::post('register', [AuthController::class, 'register']);
Route::post('login', [AuthController::class, 'login']);
Route::get('login-profiles', [AuthController::class, 'loginProfiles']);

Route::middleware('auth:sanctum')->group(function (): void {
    Route::post('logout', [AuthController::class, 'logout']);
    Route::get('user', [AuthController::class, 'user']);

    Route::get('/settings', [SettingController::class, 'index']);
    Route::put('/settings', [SettingController::class, 'update']);
    Route::get('/settings/public', [SettingController::class, 'public']);
    Route::put('/settings/wifi', [SettingController::class, 'updateWifi']);
    Route::apiResource('categories', CategoryController::class);
    Route::apiResource('products', ProductController::class);

    Route::get('products-low-stock', [ProductController::class, 'lowStock']);

    Route::get('stock-movements', [StockMovementController::class, 'index']);
    Route::get('products/{product}/stock-movements', [StockMovementController::class, 'productMovements']);
    Route::post('products/{product}/stock/increase', [StockMovementController::class, 'increase']);
    Route::post('products/{product}/stock/decrease', [StockMovementController::class, 'decrease']);
    Route::post('products/{product}/stock/correction', [StockMovementController::class, 'correction']);

    Route::post('sales/{sale}/print-ticket', [SaleController::class, 'printTicket']);
    Route::apiResource('sales', SaleController::class)->only(['index', 'store', 'show']);


    Route::get('dashboard', DashboardController::class);
    Route::get('reports/today', [ReportController::class, 'today']);
    Route::get('reports/monthly', [ReportController::class, 'monthly']);
    Route::get('workers', [ReportController::class, 'workers']);
    Route::apiResource('users', UserController::class)->only(['index', 'store', 'update', 'destroy']);
});
