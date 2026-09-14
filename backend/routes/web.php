<?php

use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| SPA Fallback — Serve the React frontend for all non-API web routes
|--------------------------------------------------------------------------
|
| The React build (dist/) is copied into public/ so Laravel can serve it.
| Any path that is NOT an API route and NOT an existing file is forwarded
| to the React index.html which handles client-side routing.
|
*/

Route::fallback(function () {
    $indexPath = public_path('index.html');

    if (file_exists($indexPath)) {
        return response()->file($indexPath, [
            'Content-Type' => 'text/html',
        ]);
    }

    // Dev mode: no React build present yet
    return response()->json([
        'name' => config('app.name'),
        'status' => 'ok',
        'note' => 'React build not found in public/. Run: npm run build && copy dist to backend/public.',
    ]);
});
